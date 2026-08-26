'use client';
import { useState } from 'react';

/** Five tones, light → dark. The mediums exist because full light is too bright
 *  and full dark is too dark for some eyes — they re-map the neutral palette
 *  (html[data-tone="medium"], see globals.css). Auto follows the system. */
const MODES = ['light', 'mediumlight', 'auto', 'mediumdark', 'dark'] as const;
type Mode = (typeof MODES)[number];
const LABEL: Record<Mode, string> = {
  light: 'Light', mediumlight: 'Soft', auto: 'Auto (follows system)', mediumdark: 'Dim', dark: 'Dark',
};

function readMode(): Mode {
  const m = document.cookie.match(/(?:^|;\s*)theme=(dark|light|mediumdark|mediumlight)/);
  return (m?.[1] as Mode) ?? 'auto';
}

function apply(mode: Mode) {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  try { localStorage.removeItem('theme'); } catch { /* legacy value must never resurrect a cookie */ }
  if (mode === 'auto') document.cookie = `theme=; max-age=0; path=/; samesite=lax${secure}`;
  else document.cookie = `theme=${mode}; max-age=31536000; path=/; samesite=lax${secure}`;
  const dark = mode === 'dark' || mode === 'mediumdark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  if (mode === 'mediumlight' || mode === 'mediumdark') document.documentElement.setAttribute('data-tone', 'medium');
  else document.documentElement.removeAttribute('data-tone');
}

export function ThemeToggle() {
  // Lazy init: the toggle only ever renders client-side (inside an opened menu),
  // so read the real value BEFORE first paint — no Auto→saved flash.
  const [mode, setMode] = useState<Mode>(() => (typeof document === 'undefined' ? 'auto' : readMode()));
  const idx = MODES.indexOf(mode);
  return (
    <div className="w-full">
      <div className="mb-0.5 flex items-center justify-between text-[10px] text-neutral-500">
        <span aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" /></svg>
        </span>
        <span className="font-medium text-neutral-600 dark:text-neutral-300">{LABEL[mode]}</span>
        <span aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></svg>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={4}
        step={1}
        value={idx}
        aria-label="Theme tone"
        aria-valuetext={LABEL[mode]}
        list="theme-ticks"
        className="w-full cursor-pointer accent-neutral-700 dark:accent-neutral-300"
        onChange={(e) => { const m = MODES[Number(e.target.value)] ?? 'auto'; setMode(m); apply(m); }}
      />
      <datalist id="theme-ticks">
        {MODES.map((_, i) => <option key={i} value={i} />)}
      </datalist>
      {/* labels centred under the actual thumb stops: track is inset ~8px (half thumb)
          on each side, stops at i/4 across the remainder */}
      <div className="relative mx-2 mt-0.5 h-3 text-[9px] leading-none text-neutral-400">
        {(['Light', 'Soft', 'Auto', 'Dim', 'Dark'] as const).map((l, i) => (
          <span key={l} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(i / 4) * 100}%` }}>{l}</span>
        ))}
      </div>
    </div>
  );
}
