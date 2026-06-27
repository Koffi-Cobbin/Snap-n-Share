const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.85;
// Files smaller than this are already small enough — skip the canvas round-trip entirely
const SKIP_THRESHOLD_BYTES = 400 * 1024; // 400 KB

// Semaphore: only one compression runs at a time to avoid OOM on low-memory devices
let compressionInProgress = false;
const compressionQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (!compressionInProgress) {
    compressionInProgress = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => compressionQueue.push(resolve));
}

function releaseSlot() {
  const next = compressionQueue.shift();
  if (next) {
    next();
  } else {
    compressionInProgress = false;
  }
}

function targetDimensions(w: number, h: number): { width: number; height: number } {
  if (w <= MAX_DIMENSION && h <= MAX_DIMENSION) return { width: w, height: h };
  if (w >= h) {
    return { width: MAX_DIMENSION, height: Math.round((h * MAX_DIMENSION) / w) };
  }
  return { width: Math.round((w * MAX_DIMENSION) / h), height: MAX_DIMENSION };
}

/**
 * Memory-efficient path: createImageBitmap decodes + resizes in one step,
 * so peak RAM is the *output* size (≤ 1920×1080 × 4 ≈ 8 MB), not the original.
 */
async function compressViaImageBitmap(file: File): Promise<Blob> {
  // First pass: get natural dimensions with minimal memory
  const probe = await createImageBitmap(file);
  const { width: nw, height: nh } = probe;
  probe.close();

  const { width, height } = targetDimensions(nw, nh);

  // Second pass: decode + resize to target size in one call
  const bitmap = await createImageBitmap(file, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });

  let blob: Blob;

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context on OffscreenCanvas");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  } else {
    // OffscreenCanvas not available (some older Safari); fall back to regular canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context on canvas");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        JPEG_QUALITY
      )
    );
  }

  return blob;
}

/**
 * Legacy fallback for browsers that don't support createImageBitmap with resize options.
 * Loads the full image first, then draws scaled — higher peak RAM but works everywhere.
 */
async function compressViaCanvas(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const { width, height } = targetDimensions(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        JPEG_QUALITY
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(file: File): Promise<Blob> {
  // Already small enough — uploading as-is is fine
  if (file.size < SKIP_THRESHOLD_BYTES) return file;

  await acquireSlot();
  try {
    // Prefer the memory-efficient path; fall back if the browser doesn't support it
    if (typeof createImageBitmap !== "undefined") {
      try {
        return await compressViaImageBitmap(file);
      } catch {
        // e.g. resize options not supported in older Safari — fall through
      }
    }
    return await compressViaCanvas(file);
  } finally {
    releaseSlot();
  }
}
