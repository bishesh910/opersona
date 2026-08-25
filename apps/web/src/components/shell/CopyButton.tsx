'use client';
import { useState } from 'react';

/** Copy with feedback and a fallback that works where the async Clipboard API is blocked
 *  (older iOS Safari, non-secure contexts): hidden textarea + execCommand inside the same tap. */
export function copyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    // also fire the modern API (best-effort, async) — harmless if it rejects
    navigator.clipboard?.writeText(text).catch(() => {});
    return ok || !!navigator.clipboard;
  } catch { return false; }
}

export function CopyButton({ text, className = 'btn-secondary btn-sm shrink-0' }: { text: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className={className}
      onClick={() => { const ok = copyText(text); setState(ok ? 'ok' : 'fail'); setTimeout(() => setState('idle'), 2000); }}
    >
      {state === 'ok' ? 'Copied ✓' : state === 'fail' ? 'Select & copy' : 'Copy'}
    </button>
  );
}
