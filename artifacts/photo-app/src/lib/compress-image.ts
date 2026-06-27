/**
 * Memory-safe image compression.
 *
 * Strategy (best → fallback):
 *  1. WebCodecs ImageDecoder  — hardware-accelerated, frame lives in GPU memory not JS heap
 *  2. createImageBitmap+resize — browser-native, efficient but peak ≈ decoded pixel count
 *  3. Legacy Canvas            — widest compat, highest peak memory
 *
 * On OOM the fallback chain retries at progressively smaller output dimensions.
 * Only one compression runs at a time (semaphore) so rapid shots don't stack allocations.
 */

const JPEG_QUALITY = 0.85;
const SKIP_THRESHOLD_BYTES = 400 * 1024; // files already this small need no compression

// Output dimension steps tried in order; lower steps used only on OOM
const DIM_STEPS = [1920, 1280, 960, 640] as const;

// ─── Semaphore ────────────────────────────────────────────────────────────────
// One compression at a time → prevents stacking 256 MB allocations on rapid shots
let _busy = false;
const _queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (!_busy) { _busy = true; return Promise.resolve(); }
  return new Promise(resolve => _queue.push(resolve));
}

function releaseSlot() {
  const next = _queue.shift();
  if (next) next(); else _busy = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scaleTo(origW: number, origH: number, maxDim: number) {
  if (origW <= maxDim && origH <= maxDim) return { width: origW, height: origH };
  const r = origW >= origH
    ? { width: maxDim, height: Math.round(origH * maxDim / origW) }
    : { width: Math.round(origW * maxDim / origH), height: maxDim };
  return r;
}

function isOOM(e: unknown): boolean {
  if (e instanceof RangeError) return true;
  const msg = e instanceof Error ? e.message.toLowerCase() : "";
  return msg.includes("memory") || msg.includes("oom") || msg.includes("alloc") || msg.includes("out of");
}

/**
 * Read JPEG/PNG native dimensions from the first kilobytes of the file —
 * zero pixel decoding, zero heap allocation beyond the header slice.
 */
async function readNativeDimensions(file: File): Promise<{ w: number; h: number } | null> {
  const MAX_HEADER = 65536; // 64 KB covers all JPEG SOF markers
  const buf = await file.slice(0, MAX_HEADER).arrayBuffer();
  const b = new Uint8Array(buf);
  const v = new DataView(buf);

  // JPEG: scan for SOF0 (0xC0) / SOF1 (0xC1) / SOF2 (0xC2) markers
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xFF) break;
      const marker = b[i + 1];
      i += 2;
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        const h = v.getUint16(i + 1, false);
        const w = v.getUint16(i + 3, false);
        if (w > 0 && h > 0) return { w, h };
      }
      if (i + 2 > b.length) break;
      const segLen = v.getUint16(i, false);
      if (segLen < 2) break;
      i += segLen;
    }
  }

  // PNG: width at bytes 16-19, height at 20-23
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (PNG_SIG.every((x, k) => b[k] === x)) {
    return { w: v.getUint32(16, false), h: v.getUint32(20, false) };
  }

  return null; // HEIC or other — fall back to probe decode
}

// ─── Compression tiers ────────────────────────────────────────────────────────

/**
 * Tier 1 — WebCodecs ImageDecoder (Chrome 94+, Safari 16.4+).
 * The decoded VideoFrame is held by the GPU driver, not the JS heap,
 * so a 64 MP decode doesn't blow up available RAM in the same way.
 */
async function viaWebCodecs(file: File, w: number, h: number, maxDim: number): Promise<Blob> {
  const { width, height } = scaleTo(w, h, maxDim);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ImageDecoderCtor = (globalThis as any).ImageDecoder;
  const decoder = new ImageDecoderCtor({ data: file.stream(), type: file.type || "image/jpeg" });

  const { image: frame } = await decoder.decode({ frameIndex: 0 });
  decoder.close();

  const canvas = new OffscreenCanvas(width, height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (canvas as any).getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) { frame.close(); throw new Error("no ctx"); }
  ctx.drawImage(frame, 0, 0, width, height);
  frame.close();

  return (canvas as unknown as { convertToBlob(opts: object): Promise<Blob> })
    .convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
}

/**
 * Tier 2 — createImageBitmap with resize options.
 * Resize happens inside the browser codec, so peak ≈ decoded full-res pixels.
 * Good for images up to ~20 MP on most phones.
 */
async function viaImageBitmap(file: File, w: number, h: number, maxDim: number): Promise<Blob> {
  const { width, height } = scaleTo(w, h, maxDim);

  const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); throw new Error("no ctx"); }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  }

  // OffscreenCanvas not available (older Safari)
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close(); return file; }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob null")), "image/jpeg", JPEG_QUALITY)
  );
}

/**
 * Tier 3 — Classic Image + Canvas fallback.
 * Widest compatibility, highest peak memory.
 */
async function viaCanvas(file: File, w: number, h: number, maxDim: number): Promise<Blob> {
  const { width, height } = scaleTo(w, h, maxDim);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);
    return new Promise<Blob>((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob null")), "image/jpeg", JPEG_QUALITY)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

async function compress(file: File): Promise<Blob> {
  // 1. Get native dimensions from binary header — no pixel decoding
  const dims = await readNativeDimensions(file);

  // 2. Give the GC a tick to reclaim prior allocations before the heavy decode
  await new Promise<void>(r => setTimeout(r, 0));

  const megapixels = dims ? (dims.w * dims.h) / 1_000_000 : 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasWebCodecs = typeof (globalThis as any).ImageDecoder !== "undefined";

  for (const maxDim of DIM_STEPS) {
    // If the image already fits within this step, keep its native size and stop here
    const nativeFits = dims && dims.w <= maxDim && dims.h <= maxDim;

    try {
      // Prefer WebCodecs for high-res (> 20 MP) where JS-heap decode is risky,
      // and always for the first attempt so hardware acceleration is used if possible.
      if (hasWebCodecs) {
        try {
          return await viaWebCodecs(file, dims?.w ?? maxDim, dims?.h ?? maxDim, maxDim);
        } catch (e) {
          if (!isOOM(e)) throw e;
          // OOM in WebCodecs — fall through to createImageBitmap
        }
      }

      // For very high-res on platforms without WebCodecs: warn in console
      if (!hasWebCodecs && megapixels > 20) {
        console.warn(`[compress-image] ${megapixels.toFixed(0)} MP image without WebCodecs — peak RAM may be high`);
      }

      try {
        return await viaImageBitmap(file, dims?.w ?? maxDim, dims?.h ?? maxDim, maxDim);
      } catch (e) {
        if (!isOOM(e)) throw e;
        // OOM — try canvas tier
      }

      return await viaCanvas(file, dims?.w ?? maxDim, dims?.h ?? maxDim, maxDim);
    } catch (e) {
      if (!isOOM(e)) throw e;
      // OOM at this dimension step — retry at next (lower) step
      if (nativeFits) break; // Already at native size; going lower won't help
      await new Promise<void>(r => setTimeout(r, 50)); // Breathe before next attempt
    }
  }

  // All steps failed — return the original file rather than failing the upload
  console.warn("[compress-image] All compression attempts exhausted — using original file");
  return file;
}

export async function compressImage(file: File): Promise<Blob> {
  if (file.size < SKIP_THRESHOLD_BYTES) return file;

  await acquireSlot();
  try {
    return await compress(file);
  } finally {
    releaseSlot();
  }
}
