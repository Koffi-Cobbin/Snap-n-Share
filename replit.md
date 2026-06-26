# Event Photo App

A shareable live photo gallery for events — anyone with a link or QR code can upload photos that instantly appear for everyone, no accounts needed.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/photo-app run dev` — run the frontend (port assigned by workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` — Object storage (auto-set by Replit)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, TailwindCSS, Framer Motion, PWA (vite-plugin-pwa)
- API: Express 5 + WebSocket (ws) for real-time gallery sync
- DB: PostgreSQL + Drizzle ORM
- Storage: Replit Object Storage (GCS-backed) for photos
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/events.ts` — events table schema
- `lib/db/src/schema/photos.ts` — photos table schema
- `artifacts/api-server/src/routes/events.ts` — event CRUD routes
- `artifacts/api-server/src/routes/photos.ts` — photo upload/delete routes + WS broadcast
- `artifacts/api-server/src/lib/websocket.ts` — WebSocket server (per-event rooms)
- `artifacts/api-server/src/lib/objectStorage.ts` — GCS storage client
- `artifacts/photo-app/src/pages/home.tsx` — event creation landing page
- `artifacts/photo-app/src/pages/event.tsx` — live gallery + upload + admin

## Architecture decisions

- **No auth required**: Events identified by short 8-char nanoid codes in the URL. Anyone with the code can view and upload.
- **Admin via passcode**: Organizers set a passcode at creation. A header `x-admin-passcode` is sent with delete requests; server verifies it matches.
- **Real-time via WebSocket**: API server maintains per-event rooms (`/ws?code=<code>`). On photo add/delete, it broadcasts to all connected clients. Frontend uses `react-use-websocket`.
- **2-step presigned upload**: Client requests a GCS presigned URL from the API, uploads directly to GCS, then calls the API to register the `objectPath` in the DB.
- **PWA**: Configured with `vite-plugin-pwa`, NetworkFirst strategy for API, standalone display for home screen install.

## Product

- Create an event at `/` — get a shareable link and QR code
- Any guest opens the link, takes or uploads a photo — it appears instantly for everyone
- Organizer enters the admin passcode to unlock delete buttons on each photo
- Works as an installable PWA on iOS/Android via "Add to Home Screen"

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- WebSocket path `/ws` must be listed in `artifacts/api-server/.replit-artifact/artifact.toml` paths array (it is).
- After any schema change, run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs`.
- After any OpenAPI spec change, run `pnpm --filter @workspace/api-spec run codegen`.
- `vite-plugin-pwa` has a peer dep warning on Vite 7 — it still works fine.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
