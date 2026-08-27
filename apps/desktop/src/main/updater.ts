/**
 * Update check. The app is unsigned, so macOS (Squirrel.Mac) can't silently
 * install in place — that needs Apple code-signing. Until then this is a
 * NOTIFY updater: poll a tiny version feed and tell the renderer when a newer
 * build exists, so the user can grab it with one click. (When the app is signed
 * later, this swaps for electron-updater's silent flow.)
 */
import { app } from 'electron';

const FEED = 'https://opersona.me/download/desktop-latest.json';

function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true; if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false; }
  return false;
}

export function startUpdateChecks(notify: (info: { version: string }) => void): void {
  const check = async (): Promise<void> => {
    try {
      const res = await fetch(FEED, { signal: AbortSignal.timeout(8000), cache: 'no-store' as RequestCache });
      if (!res.ok) return;
      const latest = ((await res.json()) as { version?: string }).version ?? '';
      if (latest && newer(latest, app.getVersion())) notify({ version: latest });
    } catch { /* offline is fine */ }
  };
  setTimeout(() => void check(), 4000);                 // shortly after launch
  setInterval(() => void check(), 6 * 60 * 60 * 1000);  // every 6h
}
