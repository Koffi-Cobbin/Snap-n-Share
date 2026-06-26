import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, eventsTable, photosTable } from "@workspace/db";
import {
  ListPhotosParams,
  ListPhotosResponse,
  AddPhotoParams,
  AddPhotoBody,
  AddPhotoResponse,
  DeletePhotoParams,
  VerifyAdminPasscodeParams,
  VerifyAdminPasscodeBody,
  VerifyAdminPasscodeResponse,
} from "@workspace/api-zod";
import { broadcast } from "../lib/websocket";

const router: IRouter = Router();

router.get("/events/:code/photos", async (req, res): Promise<void> => {
  const params = ListPhotosParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.code, params.data.code));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const photos = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.eventId, event.id))
    .orderBy(photosTable.uploadedAt);

  const response = ListPhotosResponse.parse(
    photos.map((p) => ({
      id: p.id,
      eventId: p.eventId,
      objectPath: p.objectPath,
      uploadedAt: p.uploadedAt.toISOString(),
    }))
  );

  res.json(response);
});

router.post("/events/:code/photos", async (req, res): Promise<void> => {
  const params = AddPhotoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.code, params.data.code));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const [photo] = await db.insert(photosTable).values({
    eventId: event.id,
    objectPath: parsed.data.objectPath,
  }).returning();

  const photoData = {
    id: photo.id,
    eventId: photo.eventId,
    objectPath: photo.objectPath,
    uploadedAt: photo.uploadedAt.toISOString(),
  };

  const response = AddPhotoResponse.parse(photoData);

  broadcast(params.data.code, {
    type: "new_photo",
    photo: photoData,
  });

  res.status(201).json(response);
});

router.delete("/events/:code/photos/:photoId", async (req, res): Promise<void> => {
  const params = DeletePhotoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const adminPasscode = req.headers["x-admin-passcode"] as string | undefined;

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.code, params.data.code));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (event.adminPasscode && event.adminPasscode !== adminPasscode) {
    res.status(403).json({ error: "Invalid admin passcode" });
    return;
  }

  const [deleted] = await db
    .delete(photosTable)
    .where(
      and(
        eq(photosTable.id, params.data.photoId),
        eq(photosTable.eventId, event.id)
      )
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  broadcast(params.data.code, {
    type: "delete_photo",
    photoId: params.data.photoId,
  });

  res.sendStatus(204);
});

router.post("/events/:code/admin/verify", async (req, res): Promise<void> => {
  const params = VerifyAdminPasscodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = VerifyAdminPasscodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.code, params.data.code));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const valid = event.adminPasscode === parsed.data.passcode;
  const response = VerifyAdminPasscodeResponse.parse({ valid });
  res.json(response);
});

export default router;
