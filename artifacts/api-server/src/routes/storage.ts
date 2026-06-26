import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import express from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import {
  buildLocalUploadURL,
  localObjectPath,
  uuidFromObjectPath,
  saveLocalUpload,
  readLocalObject,
} from "../lib/localDiskStorage";

const router: IRouter = Router();

function getBackend(): "replit" | "local" {
  const val = process.env.STORAGE_BACKEND ?? "replit";
  return val === "local" ? "local" : "replit";
}

const replitStorage = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Returns an upload URL and objectPath.
 * - replit backend: presigned GCS URL + /objects/... path
 * - local backend:  /api/storage/local-upload/:uuid URL + /objects/uploads/:uuid path
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    let uploadURL: string;
    let objectPath: string;

    if (getBackend() === "local") {
      const uuid = randomUUID();
      uploadURL = buildLocalUploadURL(req.headers, uuid);
      objectPath = localObjectPath(uuid);
    } else {
      uploadURL = await replitStorage.getObjectEntityUploadURL();
      objectPath = replitStorage.normalizeObjectEntityPath(uploadURL);
    }

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/local-upload/:uuid
 *
 * Receives a raw binary PUT and saves it to local disk.
 * Only used when STORAGE_BACKEND=local.
 */
router.put(
  "/storage/local-upload/:uuid",
  express.raw({ type: "*/*", limit: "50mb" }),
  async (req: Request, res: Response) => {
    if (getBackend() !== "local") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const rawUuid = req.params.uuid;
    const uuid = Array.isArray(rawUuid) ? rawUuid[0] : rawUuid;
    if (!uuid || !/^[0-9a-f-]+$/i.test(uuid)) {
      res.status(400).json({ error: "Invalid upload ID" });
      return;
    }

    const body = req.body as Buffer;
    const contentType =
      (req.headers["content-type"] as string | undefined) ?? "application/octet-stream";

    try {
      await saveLocalUpload(uuid, body, contentType);
      res.status(200).json({ ok: true });
    } catch (error) {
      req.log.error({ err: error }, "Error saving local upload");
      res.status(500).json({ error: "Failed to save upload" });
    }
  }
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS (replit) or local uploads dir.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;

    if (getBackend() === "local") {
      const result = await readLocalObject(filePath);
      if (!result) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(result.body);
      return;
    }

    const file = await replitStorage.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await replitStorage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities from PRIVATE_OBJECT_DIR (replit) or local disk.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    if (getBackend() === "local") {
      const uuid = uuidFromObjectPath(objectPath);
      if (!uuid) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const result = await readLocalObject(uuid);
      if (!result) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(result.body);
      return;
    }

    const objectFile = await replitStorage.getObjectEntityFile(objectPath);
    const response = await replitStorage.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
