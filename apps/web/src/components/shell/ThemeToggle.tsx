'use client';
import { useState } from 'react';

type Mode = 'light' | 'auto' | 'dark';

function readMode(): Mode {
  const m = document.cookie.match(/(?:^|;\s*)theme=(dark|light)/);
  return (m?.[1] as Mode) ?? 'auto';
}

function apply(mode: Mode) {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  try { localStorage.removeItem('theme'); } catch { /* legacy value must never resurrect a cookie */ }
  if (mode === 'auto') document.cookie = `theme=; max-age=0; path=/; samesite=lax${secure}`;
  else document.cookie = `theme=${mode}; max-age=31536000; path=/; samesite=lax${secure}`;
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  // Lazy init: the toggle only ever renders client-side (inside an opened menu),
  // so read the real value BEFORE first paint — no Auto→saved flash.
  const [mode, setMode] = useState<Mode>(() => (typeof document === 'undefined' ? 'auto' : readMode()));
  const opts: { m: Mode; label: string }[] = [{ m: 'light', label: 'Light' }, { m: 'auto', label: 'Auto' }, { m: 'dark', label: 'Dark' }];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      {opts.map((o) => (
        <button
          key={o.m}
          type="button"
          onClick={() => { setMode(o.m); apply(o.m); }}
          className={`flex-1 rounded-md px-2 py-1 text-xs ${mode === o.m ? 'bg-white font-medium shadow-sm dark:bg-neutral-700' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
