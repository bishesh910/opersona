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
  const opts: { m: Mode; label: string; icon: React.ReactNode }[] = [
    { m: 'light', label: 'Light', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" /></svg> },
    { m: 'auto', label: 'Auto (follows system)', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4.5" width="18" height="12.5" rx="2" /><path d="M9 20.5h6M12 17v3.5" /></svg> },
    { m: 'dark', label: 'Dark', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></svg> },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.m}
          type="button"
          role="radio"
          aria-checked={mode === o.m}
          aria-label={o.label}
          title={o.label}
          onClick={() => { setMode(o.m); apply(o.m); }}
          className={`rounded-md p-1.5 ${mode === o.m ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
