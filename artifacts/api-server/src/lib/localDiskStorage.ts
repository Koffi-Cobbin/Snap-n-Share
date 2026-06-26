import { promises as fs } from "fs";
import { join } from "path";
import { IncomingHttpHeaders } from "http";

export function getUploadsDir(): string {
  return process.env.LOCAL_UPLOADS_DIR ?? join(process.cwd(), "uploads");
}

async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(getUploadsDir(), { recursive: true });
}

export function buildLocalUploadURL(
  headers: IncomingHttpHeaders,
  uuid: string
): string {
  const proto =
    (headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = (headers["host"] as string | undefined) ?? "localhost:8080";
  return `${proto}://${host}/api/storage/local-upload/${uuid}`;
}

export function localObjectPath(uuid: string): string {
  return `/objects/uploads/${uuid}`;
}

export function uuidFromObjectPath(objectPath: string): string | null {
  const match = objectPath.match(/^\/objects\/uploads\/([0-9a-f-]+)$/);
  return match ? match[1] : null;
}

export async function saveLocalUpload(
  uuid: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await ensureUploadsDir();
  const dir = getUploadsDir();
  await Promise.all([
    fs.writeFile(join(dir, uuid), body),
    fs.writeFile(join(dir, `${uuid}.ct`), contentType),
  ]);
}

export async function readLocalObject(
  uuid: string
): Promise<{ body: Buffer; contentType: string } | null> {
  const dir = getUploadsDir();
  try {
    const [body, ctRaw] = await Promise.all([
      fs.readFile(join(dir, uuid)),
      fs.readFile(join(dir, `${uuid}.ct`), "utf-8").catch(() => "application/octet-stream"),
    ]);
    return { body, contentType: ctRaw.trim() };
  } catch {
    return null;
  }
}
