import { ENGINE_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Claude Code SessionEnd hook target. No web session — the engine validates the personal
 * ingest token (Bearer ocp_…). We just stream the body through.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ocp_')) return Response.json({ error: 'missing ingest token' }, { status: 401 });
  const url = new URL(ENGINE_URL.replace(/\/?$/, '/') + 'ingest/claude-code');
  for (const k of ['session', 'project']) { const v = new URL(req.url).searchParams.get(k); if (v) url.searchParams.set(k, v); }
  const body = await req.text();
  if (body.length > 30 * 1024 * 1024) return Response.json({ error: 'transcript too large' }, { status: 413 });
  const up = await fetch(url, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-ndjson' }, body });
  return new Response(await up.text(), { status: up.status, headers: { 'content-type': 'application/json' } });
}
