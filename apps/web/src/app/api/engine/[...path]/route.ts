/**
 * Authenticated proxy to the engine. The browser never talks to the engine directly:
 * this route checks session + org + clone ownership, injects orgId/userId, adds the
 * internal bearer token, and forwards. (Conversation/chat paths are gone — all
 * talking moved to the claude.ai connector; `authorize` rejects them.)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCtx, getOrgCtx } from '@/lib/session';
import { authorize } from '@/lib/engine-authz';
import { ENGINE_URL, ENGINE_INTERNAL_TOKEN } from '@/lib/env';
import { engineLimitFor, rateLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  const s = await getSessionCtx();
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!s.approved) return NextResponse.json({ error: 'account pending approval' }, { status: 403 });
  const ctx = await getOrgCtx(s);
  if (!ctx) return NextResponse.json({ error: 'no organization' }, { status: 403 });

  const verdict = await authorize(ctx, req.method, path);
  if (!('ok' in verdict)) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

  // Cost guard: sliding-window limits on the expensive calls (per user, in-memory).
  const lim = engineLimitFor(req.method, path);
  if (lim) {
    const r = rateLimit(`${ctx.userId}:${lim.bucket}`, lim.rule);
    if (!r.ok) return NextResponse.json({ error: `Slow down — ${r.label}. Try again in ${r.retryAfterS}s.` }, { status: 429, headers: { 'Retry-After': String(r.retryAfterS) } });
  }

  // Build upstream URL: forward query, force orgId.
  const upstream = new URL(path.map(encodeURIComponent).join('/'), ENGINE_URL.replace(/\/?$/, '/'));
  req.nextUrl.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
  upstream.searchParams.set('orgId', ctx.orgId);

  const headers: Record<string, string> = { Authorization: `Bearer ${ENGINE_INTERNAL_TOKEN}` };
  let body: BodyInit | undefined;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json') || ct === '') {
      let json: Record<string, unknown> = {};
      const raw = await req.text();
      if (raw) {
        try { json = JSON.parse(raw) as Record<string, unknown>; }
        catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
      }
      json.orgId = ctx.orgId;
      json.userId = ctx.userId;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else {
      headers['Content-Type'] = ct;
      body = await req.arrayBuffer();
    }
  }

  let up: Response;
  try {
    up = await fetch(upstream, { method: req.method, headers, body, signal: req.signal, cache: 'no-store', redirect: 'manual' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `engine unreachable: ${msg}` }, { status: 502 });
  }

  const outHeaders = new Headers();
  outHeaders.set('Content-Type', up.headers.get('content-type') ?? 'application/json');
  outHeaders.set('Cache-Control', 'no-store');
  const cd = up.headers.get('content-disposition'); if (cd) outHeaders.set('Content-Disposition', cd);
  return new Response(up.body, { status: up.status, headers: outHeaders });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
