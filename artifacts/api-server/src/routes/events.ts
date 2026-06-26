import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, eventsTable, photosTable } from "@workspace/db";
import {
  CreateEventBody,
  CreateEventResponse,
  GetEventParams,
  GetEventResponse,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";

const router: IRouter = Router();

function generateCode(): string {
  return nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x").slice(0, 8);
}

router.post("/events", async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let code = generateCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.select().from(eventsTable).where(eq(eventsTable.code, code));
    if (existing.length === 0) break;
    code = generateCode();
    attempts++;
  }

  const [event] = await db.insert(eventsTable).values({
    code,
    name: parsed.data.name,
    adminPasscode: parsed.data.adminPasscode ?? null,
  }).returning();

  const response = CreateEventResponse.parse({
    id: event.id,
    code: event.code,
    name: event.name,
    hasAdminPasscode: event.adminPasscode != null,
    photoCount: 0,
    createdAt: event.createdAt.toISOString(),
  });

  res.status(201).json(response);
});

router.get("/events/:code", async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.code, params.data.code));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const [photoCountResult] = await db
    .select({ value: count() })
    .from(photosTable)
    .where(eq(photosTable.eventId, event.id));

  const response = GetEventResponse.parse({
    id: event.id,
    code: event.code,
    name: event.name,
    hasAdminPasscode: event.adminPasscode != null,
    photoCount: Number(photoCountResult?.value ?? 0),
    createdAt: event.createdAt.toISOString(),
  });

  res.json(response);
});

export default router;
