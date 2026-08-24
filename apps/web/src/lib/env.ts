import path from 'node:path';

/** Engine base URL as seen from the Next server process. */
export const ENGINE_URL =
  process.env.ENGINE_URL ?? process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:4000';

export const ENGINE_INTERNAL_TOKEN = process.env.ENGINE_INTERNAL_TOKEN ?? '';

/** Repo root: apps/web/../.. when running from the app dir, else cwd. */
export function repoRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'web' && path.basename(path.dirname(cwd)) === 'apps') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

/** Absolute data dir shared with the engine (ENGINE_DATA_DIR, default `data` at repo root). */
export function engineDataDir(): string {
  const raw = process.env.ENGINE_DATA_DIR?.trim() || './data';
  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot(), raw);
}
