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
  UpdatePhotoVisibilityParams,
  UpdatePhotoVisibilityBody,
  UpdatePhotoVisibilityResponse,
  VerifyAdminPasscodeParams,
  VerifyAdminPasscodeBody,
  VerifyAdminPasscodeResponse,
} from "@workspace/api-zod";
import { broadcast } from "../lib/websocket";

const router: IRouter = Router();

async function resolveEvent(code: string) {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.code, code));
  return event ?? null;
}

function isValidAdmin(event: { adminPasscode: string | null }, passcode: string | undefined): boolean {
  if (!event.adminPasscode) return true;
  return event.adminPasscode === passcode;
}

function photoRow(p: typeof photosTable.$inferSelect) {
  return {
    id: p.id,
    eventId: p.eventId,
    objectPath: p.objectPath,
    visibility: p.visibility,
    uploadedAt: p.uploadedAt.toISOString(),
  };
}

router.get("/events/:code/photos", async (req, res): Promise<void> => {
  const params = ListPhotosParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const event = await resolveEvent(params.data.code);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const adminPasscode = req.headers["x-admin-passcode"] as string | undefined;
  const admin = isValidAdmin(event, adminPasscode);

  const allPhotos = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.eventId, event.id))
    .orderBy(photosTable.uploadedAt);

  const photos = admin ? allPhotos : allPhotos.filter(p => p.visibility === "public");

  res.json(ListPhotosResponse.parse(photos.map(photoRow)));
});

router.post("/events/:code/photos", async (req, res): Promise<void> => {
  const params = AddPhotoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = AddPhotoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const event = await resolveEvent(params.data.code);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const [photo] = await db.insert(photosTable).values({
    eventId: event.id,
    objectPath: parsed.data.objectPath,
  }).returning();

  const data = photoRow(photo);
  broadcast(params.data.code, { type: "new_photo", photo: data });

  res.status(201).json(AddPhotoResponse.parse(data));
});

router.patch("/events/:code/photos/:photoId", async (req, res): Promise<void> => {
  const params = UpdatePhotoVisibilityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdatePhotoVisibilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const adminPasscode = req.headers["x-admin-passcode"] as string | undefined;

  const event = await resolveEvent(params.data.code);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  if (!isValidAdmin(event, adminPasscode)) {
    res.status(403).json({ error: "Invalid admin passcode" }); return;
  }

  const [updated] = await db
    .update(photosTable)
    .set({ visibility: parsed.data.visibility })
    .where(and(eq(photosTable.id, params.data.photoId), eq(photosTable.eventId, event.id)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Photo not found" }); return; }

  const data = photoRow(updated);

  broadcast(params.data.code, {
    type: "photo_visibility_changed",
    photoId: params.data.photoId,
    visibility: parsed.data.visibility,
    photo: data,
  });

  res.json(UpdatePhotoVisibilityResponse.parse(data));
});

router.delete("/events/:code/photos/:photoId", async (req, res): Promise<void> => {
  const params = DeletePhotoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const adminPasscode = req.headers["x-admin-passcode"] as string | undefined;

  const event = await resolveEvent(params.data.code);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  if (!isValidAdmin(event, adminPasscode)) {
    res.status(403).json({ error: "Invalid admin passcode" }); return;
  }

  const [deleted] = await db
    .delete(photosTable)
    .where(and(eq(photosTable.id, params.data.photoId), eq(photosTable.eventId, event.id)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Photo not found" }); return; }

  broadcast(params.data.code, { type: "delete_photo", photoId: params.data.photoId });

  res.sendStatus(204);
});

router.post("/events/:code/admin/verify", async (req, res): Promise<void> => {
  const params = VerifyAdminPasscodeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = VerifyAdminPasscodeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const event = await resolveEvent(params.data.code);
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const valid = event.adminPasscode === parsed.data.passcode;
  res.json(VerifyAdminPasscodeResponse.parse({ valid }));
});

export default router;
