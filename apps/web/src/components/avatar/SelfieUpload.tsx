'use client';
import { useState } from 'react';
import type { AvatarRecipe } from '@opersona/shared';

const MAX_EDGE = 512;

/** Read a file, downscale on a canvas to ≤512px, return { base64, mime }. Never leaves the browser until the POST. */
async function downscale(file: File): Promise<{ base64: string; mime: 'image/jpeg' }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h); // re-encoding also drops EXIF
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mime: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SelfieUpload({ onRecipe, disabled }: { onRecipe: (r: AvatarRecipe, confidence: Record<string, number>) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });
      const json = (await res.json().catch(() => ({}))) as { recipe?: AvatarRecipe; confidence?: Record<string, number>; error?: string };
      if (!res.ok || !json.recipe) throw new Error(json.error ?? `Engine returned ${res.status}`);
      onRecipe(json.recipe, json.confidence ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className={'btn-secondary cursor-pointer ' + (busy || disabled ? 'pointer-events-none opacity-50' : '')}>
        {busy ? 'Looking at your selfie…' : 'Upload a selfie'}
        <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy || disabled} />
      </label>
      <p className="muted text-xs">
        Your selfie is downscaled in your browser, sent once to pick hair, skin tone and clothes, and <strong>never stored</strong> — not on disk, not in the database. Only the resulting recipe is saved.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
