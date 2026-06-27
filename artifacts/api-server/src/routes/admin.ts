import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { count, eq } from "drizzle-orm";
import { db, eventsTable, photosTable } from "@workspace/db";
import { nanoid } from "nanoid";

// ─── Constants ──────────────────────────────────────────────────────────────

const GLOBAL_ADMIN_NAME = "Admin";
const GLOBAL_ADMIN_PASSCODE = "p@55Word!";
const AUTH_HEADER = "x-global-admin-passcode";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminEvent {
  id: number;
  code: string;
  name: string;
  hasAdminPasscode: boolean;
  photoCount: number;
  createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const passcode = req.headers[AUTH_HEADER] as string | undefined;
  if (passcode !== GLOBAL_ADMIN_PASSCODE) {
    res.status(403).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function asAdminEvent(event: typeof eventsTable.$inferSelect, photoCount: number): AdminEvent {
  return {
    id: event.id,
    code: event.code,
    name: event.name,
    hasAdminPasscode: event.adminPasscode != null,
    photoCount,
    createdAt: event.createdAt.toISOString(),
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

const router: IRouter = Router();

/**
 * POST /api/admin/login
 * Validates global admin credentials.
 */
router.post("/admin/login", (req: Request, res: Response): void => {
  const { name, passcode } = req.body ?? {};
  const valid = name === GLOBAL_ADMIN_NAME && passcode === GLOBAL_ADMIN_PASSCODE;
  res.json({ valid });
});

/**
 * GET /api/admin/events
 * Lists all events with photo counts. Requires admin auth.
 */
router.get("/admin/events", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const allEvents = await db
      .select()
      .from(eventsTable)
      .orderBy(eventsTable.createdAt);

    const eventsWithCounts = await Promise.all(
      allEvents.map(async (event) => {
        const [result] = await db
          .select({ value: count() })
          .from(photosTable)
          .where(eq(photosTable.eventId, event.id));

        return asAdminEvent(event, Number(result?.value ?? 0));
      }),
    );

    res.json(eventsWithCounts);
  } catch (error) {
    req.log.error({ err: error }, "Failed to list admin events");
    res.status(500).json({ error: "Failed to list events" });
  }
});

/**
 * POST /api/admin/events
 * Creates a new event. Requires admin auth.
 */
router.post("/admin/events", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, adminPasscode } = req.body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Event name is required" });
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

    const [event] = await db
      .insert(eventsTable)
      .values({
        code,
        name: name.trim(),
        adminPasscode: adminPasscode ?? null,
      })
      .returning();

    res.status(201).json(asAdminEvent(event, 0));
  } catch (error) {
    req.log.error({ err: error }, "Failed to create event via admin");
    res.status(500).json({ error: "Failed to create event" });
  }
});

/**
 * PATCH /api/admin/events/:id
 * Updates an event's name. Requires admin auth.
 */
router.patch("/admin/events/:id", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid event ID" });
      return;
    }

    const { name } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Event name is required" });
      return;
    }

    const [updated] = await db
      .update(eventsTable)
      .set({ name: name.trim() })
      .where(eq(eventsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const [result] = await db
      .select({ value: count() })
      .from(photosTable)
      .where(eq(photosTable.eventId, id));

    res.json(asAdminEvent(updated, Number(result?.value ?? 0)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to update event");
    res.status(500).json({ error: "Failed to update event" });
  }
});

/**
 * DELETE /api/admin/events/:id
 * Deletes an event and all its photos. Requires admin auth.
 */
router.delete("/admin/events/:id", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid event ID" });
      return;
    }

    const [deleted] = await db
      .delete(eventsTable)
      .where(eq(eventsTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error }, "Failed to delete event");
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// ─── Utils ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  return nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x").slice(0, 8);
}

export default router;
