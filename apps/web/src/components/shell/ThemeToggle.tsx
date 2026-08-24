'use client';
import { useEffect, useState } from 'react';

type Mode = 'light' | 'auto' | 'dark';

function apply(mode: Mode) {
  try {
    if (mode === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', mode);
    const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch { /* private mode */ }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('auto');
  useEffect(() => { try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') setMode(t); } catch { /* ignore */ } }, []);
  const opts: { m: Mode; label: string }[] = [{ m: 'light', label: 'Light' }, { m: 'auto', label: 'Auto' }, { m: 'dark', label: 'Dark' }];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      {opts.map((o) => (
        <button
          key={o.m}
          type="button"
          onClick={() => { setMode(o.m); apply(o.m); }}
          className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${mode === o.m ? 'bg-white font-medium shadow-sm dark:bg-neutral-700' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
