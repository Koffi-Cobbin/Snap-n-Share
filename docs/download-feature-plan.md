# Download Feature Plan — Snap-n-Share

> **Goal**: Allow users to select multiple photos from an event gallery and download them in batch.
>
> **Status**: Draft — awaiting approval before implementation

---

## Overview

Add checkbox-based multi-selection on photo cards + a floating "Download Selected" action bar. In the backend, a dedicated download endpoint serves individual photos with `Content-Disposition: attachment`, enabling the browser's native save dialog.

No new npm dependencies — batch download uses native `<a>` element trickle-clicks.

---

## How It Works (End-to-End)

```
 User taps photo checkbox  →  photo ID added to Set<number>
 User taps more checkboxes →  selection count updates in floating bar
 User taps "Download (N)"  →  for each selected ID:
                                  <a href="/api/events/{code}/photos/{id}/download"
                                     download="photo-{id}.jpg" />.click()
 Browser queues N downloads →  native save dialog per file
```

---

## Components

### 1. OpenAPI Spec

**File**: `lib/api-spec/openapi.yaml`

Add a new `downloadPhoto` endpoint under the `photos` tag:

```yaml
/events/{code}/photos/{photoId}/download:
  get:
    operationId: downloadPhoto
    tags: [photos]
    summary: Download a photo
    description: Returns the photo binary with Content-Disposition: attachment.
                 Guests can download public photos only.
                 Admin (x-admin-passcode) can download hidden photos too.
    parameters:
      - name: code
        in: path
        required: true
        schema:
          type: string
      - name: photoId
        in: path
        required: true
        schema:
          type: integer
      - name: x-admin-passcode
        in: header
        required: false
        schema:
          type: string
    responses:
      "200":
        description: Photo binary streamed
        content:
          "*/*":
            schema:
              type: string
              format: binary
      "403":
        description: Unauthorized (trying to download hidden photo without admin)
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ErrorEnvelope"
      "404":
        description: Event or photo not found
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ErrorEnvelope"
```

### 2. Zod Schemas (auto-generated)

**File**: `lib/api-zod/src/generated/api.ts`

Re-run Orval to generate `DownloadPhotoParams` and `DownloadPhotoHeader` Zod schemas used by the server route for request validation.

**File**: `lib/api-zod/src/generated/types/` — new type files for `DownloadPhotoParams`, `DownloadPhotoHeader`.

### 3. API Server Route

**File**: `artifacts/api-server/src/routes/photos.ts`

Add a new handler:

```typescript
router.get("/events/:code/photos/:photoId/download", async (req, res): Promise<void> => {
  // 1. Validate params with DownloadPhotoParams
  // 2. Resolve event by code
  // 3. Look up photo by eventId + photoId
  // 4. Check authorization:
  //    - If photo is public → allow download (guest)
  //    - If photo is hidden → require valid admin passcode
  // 5. Fetch object from storage backend (local or Replit GCS):
  //    - local: readLocalObject(uuid)
  //    - replit: replitStorage.getObjectEntityFile + downloadObject
  // 6. Set headers:
  //    - Content-Disposition: attachment; filename="photo-{id}.{ext}"
  //    - Content-Type from storage metadata
  // 7. Stream the response body
});
```

**Filename derivation**:
- Use content type from storage metadata
- Map `image/jpeg` → `.jpg`, `image/png` → `.png`, `image/webp` → `.webp`
- Fallback to `.jpg` if unknown

### 4. Frontend — Event Page

**File**: `artifacts/photo-app/src/pages/event.tsx`

#### Selection State

```typescript
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
```

Helpers:
- `toggleSelection(id)` — add/remove single ID
- `selectAll()` — add all visible photo IDs
- `clearSelection()` — empty the set
- `isAllSelected` — computed: `visiblePhotos.length === selectedIds.size`

#### PhotoCard Changes

Add a checkbox circle to `PhotoCard`:

| State | Appearance |
|-------|-----------|
| Unselected | Transparent circle outline, visible on hover |
| Selected | Filled primary-color circle with checkmark |
| Selection mode | All checkboxes always visible when `selectedIds.size > 0` |

Position: **top-left corner**, `z-10`, touch-friendly hit area (~36×36px).

The existing admin actions overlay stays as-is below the photo.

#### Floating Action Bar

Fixed at the bottom of the viewport, **above** the upload button (`z-40`):

```
┌─────────────────────────────────────────┐
│  3 selected    [Deselect All]    [⬇ Download (3)]  │
└─────────────────────────────────────────┘
```

- Appears when `selectedIds.size > 0`
- Slides up with Framer Motion (`y: 100 → 0`)
- Semi-transparent backdrop blur

#### Download Handler

```typescript
const handleDownloadSelected = () => {
  // Iterate selectedIds and trigger sequential downloads
  // 300ms delay between each to let the browser queue them
  selectedIds.forEach((id, index) => {
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = `/api/events/${code}/photos/${id}/download`;
      a.download = `photo-${id}.jpg`; // hint to browser
      a.click();
      a.remove();
    }, index * 300);
  });
};
```

No React Query needed — this is a side effect, not cached state.

#### Mobile Considerations

- Checkbox hit target ≥ 36×36px for fat fingers
- Floating bar respects `safe-area-inset-bottom` for notched devices
- Downloads trigger native browser save dialog on both iOS Safari and Chrome

---

## Files Changed (Summary)

| # | File | Action |
|---|------|--------|
| 1 | `lib/api-spec/openapi.yaml` | ✏️ Add `downloadPhoto` endpoint |
| 2 | `lib/api-zod/src/generated/api.ts` | 🤖 Re-generate (Orval) |
| 3 | `lib/api-zod/src/generated/types/` | 🤖 Re-generate (Orval) |
| 4 | `artifacts/api-server/src/routes/photos.ts` | ✏️ Add download handler |
| 5 | `artifacts/photo-app/src/pages/event.tsx` | ✏️ Add selection + download UI |
| 6 | `artifacts/photo-app/src/components/ui/` | 🟢 None needed (use existing) |

---

## What's NOT in Scope (V1)

- **ZIP batch download** — would require a server-side zip-stream or client-side JSZip. Browser-native sequential downloads cover the 90% use case with zero dependencies.
- **Download progress indicator** — browser download manager handles this natively.
- **Persistent selection across navigation** — selection is ephemeral, scoped to the current page session.
- **Watermarking or DRM** — photos are downloaded as-is from storage.

---

## Edge Cases Handled

| Case | Behavior |
|------|----------|
| Guest taps download on hidden photo | 403 — only public photos downloadable |
| Admin downloads hidden photo | Works with valid `x-admin-passcode` header |
| Photo deleted between list load and download | 404 — silently skip (no toast) |
| All photos deselected | Floating bar hides immediately |
| 0 photos in event | Selection state is empty, bar never shows |
| Photo doesn't load in storage backend | 500 — skip that download, continue with rest |
| User on slow network | Sequential downloads queue in browser's native download manager |
