# Task Context: Admin Event Persistence

Session ID: 2026-06-27-admin-event-persistence
Created: 2026-06-27T08:57:00Z
Status: in_progress

## Current Request
Persist admin's events to localStorage so that when the admin closes and reopens the app:
1. They can see a list of their created events on the Home page
2. They can reopen events without needing the URL
3. They auto-authenticate as admin without re-entering the passcode
4. Access persists for at least a week (localStorage is indefinite)

## Context Files (Standards to Follow)
- .opencode/context/core/standards/code-quality.md

## Reference Files (Source Material to Look At)
- artifacts/photo-app/src/pages/home.tsx (add My Events section)
- artifacts/photo-app/src/pages/event.tsx (auto-auth on mount, save on create/login)
- artifacts/photo-app/src/lib/utils.ts (existing lib pattern to follow)
- lib/api-client-react/src/generated/api.schemas.ts (Event type)
- lib/api-client-react/src/generated/api.ts (useGetEvent hook)

## External Docs Fetched
None needed.

## Components
1. `src/lib/my-events.ts` (NEW) - Pure localStorage CRUD helpers
2. `src/pages/home.tsx` (MODIFY) - Add "My Events" section below create form
3. `src/pages/event.tsx` (MODIFY) - Auto-auth from localStorage on mount, save on create/login

## Constraints
- localStorage only (no server changes, no accounts, no cookies)
- Must preserve the app's zero-auth privacy-first design
- Passcode must never appear in the URL
- Must handle localStorage parsing errors gracefully (try/catch)

## Exit Criteria
- [ ] my-events.ts created with getMyEvents, saveMyEvent, removeMyEvent, getMyEvent, touchMyEvent
- [ ] Home page shows saved events with name, photo count, date, Open button
- [ ] Event page auto-authenticates admin from saved passcode on mount
- [ ] Event page saves event on creation redirect and on successful admin login
- [ ] All states handled: empty, loading, error
