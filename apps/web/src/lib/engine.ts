import { ENGINE_URL, ENGINE_INTERNAL_TOKEN } from './env';

export class EngineError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Server→engine call with the internal bearer token. Throws EngineError on non-2xx. */
export async function engineFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), ENGINE_URL.replace(/\/?$/, '/'));
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${ENGINE_INTERNAL_TOKEN}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? text ?? res.statusText;
    throw new EngineError(res.status, msg || `engine ${res.status}`);
  }
  return json as T;
}

/** Best-effort snapshot re-render after a persona write. Never throws (engine may be down). */
export async function snapshotClone(cloneId: string, orgId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await engineFetch(`/clones/${cloneId}/snapshot`, { body: { orgId } });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[web] snapshot failed for clone ${cloneId}: ${msg}`);
    return { ok: false, error: msg };
  }
}
