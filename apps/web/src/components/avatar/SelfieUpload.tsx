'use client';
import { useRef, useState } from 'react';
import type { AvatarRecipe } from '@opersona/shared';

const MAX_EDGE = 512;

/** Read a file, downscale to ≤512px, return { base64, mime }. Tries createImageBitmap
 *  (handles EXIF rotation + more formats), then <img>; if the browser can't decode it at
 *  all (e.g. HEIC on some browsers) the RAW file is sent and the server converts it. */
async function downscale(file: File): Promise<{ base64: string; mime: string }> {
  const draw = (w0: number, h0: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const k = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    paint(ctx, w, h); // re-encoding also drops EXIF
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (dataUrl.length < 200) throw new Error('blank canvas');
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mime: 'image/jpeg' as const };
  };
  // 1) createImageBitmap — most reliable, applies EXIF orientation
  try {
    const bmp = await createImageBitmap(file);
    try { return draw(bmp.width, bmp.height, (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h)); } finally { bmp.close(); }
  } catch { /* fall through */ }
  // 2) <img> decode
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return draw(img.naturalWidth, img.naturalHeight, (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h));
  } catch { /* fall through */ } finally { URL.revokeObjectURL(url); }
  // 3) raw passthrough — let the server's image library convert (HEIC etc.)
  if (file.size > 10 * 1024 * 1024) throw new Error('Photo is too large (over 10MB) — pick a smaller one or screenshot it');
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
  return { base64: btoa(bin), mime: file.type || 'application/octet-stream' };
}

export function SelfieUpload({ onRecipe, disabled }: { onRecipe: (r: AvatarRecipe, confidence: Record<string, number>) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image'); return; }
    setBusy(true); setError(null);
    try {
      const { base64, mime } = await downscale(file);
      const res = await fetch('/api/engine/avatar/from-selfie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mime }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = (await res.json().catch(() => ({}))) as { recipe?: AvatarRecipe; confidence?: Record<string, number>; error?: string };
      if (!res.ok || !json.recipe) throw new Error(json.error ?? `Engine returned ${res.status}`);
      onRecipe(json.recipe, json.confidence ?? {});
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setError(/abort|timeout/i.test(m) ? 'Took too long — the AI reader may be busy. Try once more.' : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Most reliable pattern on iOS: the file input itself, transparent, laid OVER the
          visual button — the tap lands on the native input directly (no label forwarding,
          no programmatic click). Button onClick is kept as a second path. */}
      <div className="relative inline-block">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || disabled}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Looking at your selfie…' : 'Upload a selfie'}
        </button>
        {!busy && !disabled && (
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            aria-label="Upload a selfie"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 [font-size:16px]"
          />
        )}
      </div>
      <p className="muted text-xs">
        Your selfie is downscaled in your browser, sent once to pick hair, skin tone and clothes, and <strong>never stored</strong> — not on disk, not in the database. Only the resulting recipe is saved.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
