/**
 * localStorage persistence for admin-created events.
 *
 * This is the only persistence layer for admin recovery — no cookies, no
 * server sessions, no accounts. Data stays on-device and is fully under
 * the user's control.
 *
 * @module my-events
 */

export interface PersistedEvent {
  code: string;
  name: string;
  adminPasscode: string;
  createdAt: string;
  lastAccessedAt: string;
}

const STORAGE_KEY = "snap-n-share-my-events";

/** Read all saved events from localStorage. Returns [] on any error. */
export function getMyEvents(): PersistedEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistedEvent);
  } catch {
    return [];
  }
}

/** Add or update an event in localStorage. */
export function saveMyEvent(
  event: Omit<PersistedEvent, "lastAccessedAt"> & { lastAccessedAt?: string },
): void {
  const events = getMyEvents();
  const idx = events.findIndex((e) => e.code === event.code);
  const entry: PersistedEvent = {
    ...event,
    lastAccessedAt: event.lastAccessedAt ?? new Date().toISOString(),
  };

  if (idx >= 0) {
    events[idx] = { ...events[idx], ...entry };
  } else {
    events.unshift(entry);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

/** Remove an event from localStorage by code. */
export function removeMyEvent(code: string): void {
  const events = getMyEvents().filter((e) => e.code !== code);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

/** Look up a single event by code. */
export function getMyEvent(code: string): PersistedEvent | undefined {
  return getMyEvents().find((e) => e.code === code);
}

/** Update the last-accessed timestamp for an event. */
export function touchMyEvent(code: string): void {
  const events = getMyEvents();
  const existing = events.find((e) => e.code === code);
  if (existing) {
    saveMyEvent({ ...existing, lastAccessedAt: new Date().toISOString() });
  }
}

// ─── Type guard ──────────────────────────────────────────────────────────────

function isPersistedEvent(value: unknown): value is PersistedEvent {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.code === "string" &&
    typeof obj.name === "string" &&
    typeof obj.adminPasscode === "string" &&
    typeof obj.createdAt === "string"
  );
}
