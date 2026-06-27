# Task Context: Download Feature

Session ID: 2026-06-27-download-feature
Created: 2026-06-27T08:00:00Z
Status: in_progress

## Current Request
Add checkbox-based multi-select and batch download feature for event photos. Users can select multiple photos and download them all at once.

## Context Files (Standards to Follow)
- .opencode/context/core/standards/code-quality.md
- .opencode/context/core/essential-patterns.md
- .opencode/context/ui/web/react-patterns.md
- .opencode/context/ui/web/ui-styling-standards.md

## Reference Files (Source Material)
- lib/api-spec/openapi.yaml
- lib/api-zod/src/generated/api.ts
- artifacts/api-server/src/routes/photos.ts
- artifacts/api-server/src/routes/storage.ts
- artifacts/api-server/src/lib/localDiskStorage.ts
- artifacts/api-server/src/lib/objectStorage.ts
- artifacts/photo-app/src/pages/event.tsx
- lib/api-client-react/src/generated/api.ts

## Components
1. OpenAPI Spec — Add downloadPhoto endpoint
2. Zod Schemas — Auto-generated via Orval
3. API Server Route — Download handler in photos.ts
4. Frontend UI — Selection state, checkbox, floating action bar in event.tsx

## Constraints
- No new npm dependencies
- Follow existing code patterns (Express + Zod validation, React + React Query + Framer Motion)
- Mobile-friendly touch targets
- Guests: public photos only; Admin: all photos including hidden

## Exit Criteria
- [ ] OpenAPI spec updated with downloadPhoto endpoint
- [ ] Zod schemas regenerated
- [ ] Server download handler implemented and typechecks
- [ ] Frontend selection + download UI rendered and functional
- [ ] pnpm run typecheck passes
