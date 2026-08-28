/**
 * Authenticated proxy to the engine. The browser never talks to the engine directly:
 * this route checks session + org + clone ownership, injects orgId/userId, adds the
 * internal bearer token, and forwards. `events` is relayed as a live SSE stream.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { and, count, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { redactSecrets } from '@opersona/shared';
import { getSessionCtx, getOrgCtx } from '@/lib/session';
import { authorize } from '@/lib/engine-authz';
import { ENGINE_URL, ENGINE_INTERNAL_TOKEN } from '@/lib/env';
import { engineLimitFor, rateLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path: string[] }> };

/** Titles we are allowed to overwrite with the first user message (see auto-title below). */
const DEFAULT_TITLE = /^(Chat \d{4}-\d{2}-\d{2} \d{2}:\d{2}|Clone test \d|Persona test \d{4}-\d{2}-\d{2} \d{2}:\d{2}|Conversation .*|New conversation|New chat)$/;
const isDefaultTitle = (t: string) => DEFAULT_TITLE.test(t.trim());

/** Sanity limits for attachments forwarded to the engine (it re-validates). */
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
type Attachment = { name: string; mime: string; dataBase64: string };
function parseAttachments(raw: unknown): Attachment[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return 'attachments must be an array';
  if (raw.length > MAX_ATTACHMENTS) return `at most ${MAX_ATTACHMENTS} attachments`;
  const out: Attachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') return 'bad attachment';
    const { name, mime, dataBase64 } = a as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return 'attachment name required';
    if (typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return `bad mime for ${name}`;
    if (typeof dataBase64 !== 'string' || !dataBase64) return `empty attachment ${name}`;
    if (dataBase64.length * 0.75 > MAX_ATTACHMENT_BYTES) return `${name} exceeds 10 MB`;
    out.push({ name: name.trim(), mime, dataBase64 });
  }
  return out;
}

/** A refused send must leave no trace: drop the user turn AND un-strand the
 *  conversation status (a stale 'live' locks the composer at "Thinking…" on
 *  every future page load — the stuck-chat bug). */
async function rollbackSend(turnId: string, conversationId?: string): Promise<void> {
  await db.delete(schema.turns).where(eq(schema.turns.id, turnId)).catch(() => {});
  if (conversationId) {
    await db.update(schema.conversations).set({ status: 'idle' }).where(eq(schema.conversations.id, conversationId)).catch(() => {});
  }
}

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
  let insertedTurnId: string | null = null;

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
      // Never trust the client for the persona a conversation belongs to.
      if (path[0] === 'conversations' && verdict.cloneId) json.cloneId = verdict.cloneId;

      // Chat: persist the user turn before the engine sees it (engine persists assistant turns).
      if (path[0] === 'conversations' && path[2] === 'messages' && verdict.conversationId) {
        const text = typeof json.text === 'string' ? json.text.trim() : '';
        const attachments = parseAttachments(json.attachments);
        if (typeof attachments === 'string') return NextResponse.json({ error: attachments }, { status: 400 });
        if (!text && attachments.length === 0) return NextResponse.json({ error: 'text is required' }, { status: 400 });
        json.text = text;
        if (attachments.length) json.attachments = attachments; else delete json.attachments;
        json.cloneId = verdict.cloneId; // never trust the client for this
        // Sealed workspaces: the browser sends a ciphertext copy for storage; the
        // plaintext is transit-only (fed to the model, never persisted here).
        const sealedCopy = typeof json.sealed === 'string' && json.sealed.startsWith('enc1:') && json.sealed.length < 400_000 ? json.sealed : null;
        delete json.sealed;
        // History stores what was attached (names only) — never the bytes.
        const stored = sealedCopy ?? (redactSecrets(text) + (attachments.length ? `${text ? '\n' : ''}[attached: ${attachments.map((a) => a.name).join(', ')}]` : ''));
        const convId = verdict.conversationId;
        insertedTurnId = await db.transaction(async (tx) => {
          const [t] = await tx.insert(schema.turns)
            .values({ conversationId: convId, orgId: ctx.orgId, role: 'user', content: stored })
            .returning({ id: schema.turns.id });
          const patch: Partial<typeof schema.conversations.$inferInsert> = { lastActivityAt: new Date(), status: 'live' };
          // Auto-title: the first user message names an untitled conversation.
          // (Never for sealed messages — a title would leak content in plaintext.)
          if (!sealedCopy && verdict.conversationTitle != null && isDefaultTitle(verdict.conversationTitle)) {
            const [{ n }] = await tx.select({ n: count() }).from(schema.turns).where(and(eq(schema.turns.conversationId, convId), eq(schema.turns.role, 'user')));
            if (n <= 1) {
              const base = (text || attachments.map((a) => a.name).join(', ')).replace(/\s+/g, ' ').trim();
              if (base) patch.title = base.length > 60 ? base.slice(0, 60).trimEnd() + '…' : base;
            }
          }
          await tx.update(schema.conversations).set(patch).where(eq(schema.conversations.id, convId));
          return t!.id;
        });
      }
      if (path[0] === 'conversations' && path[2] === 'end' && verdict.conversationId) {
        await db.update(schema.conversations).set({ lastActivityAt: new Date(), status: 'idle' }).where(eq(schema.conversations.id, verdict.conversationId));
      }
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else {
      headers['Content-Type'] = ct;
      body = await req.arrayBuffer();
    }
  }

  const isEvents = path[0] === 'conversations' && path[2] === 'events';
  if (isEvents) {
    headers.Accept = 'text/event-stream';
    // EventSource cannot set headers, so the client passes the last seen id as ?after=.
    const last = req.headers.get('last-event-id') ?? req.nextUrl.searchParams.get('after');
    if (last && /^\d{1,12}$/.test(last)) headers['Last-Event-ID'] = last;
    upstream.searchParams.delete('after');
  }

  let up: Response;
  try {
    up = await fetch(upstream, { method: req.method, headers, body, signal: req.signal, cache: 'no-store', redirect: 'manual' });
  } catch (e) {
    // A client abort (tab closed mid-send) is not an engine refusal: the engine has the
    // request and will likely finish the turn — keep the user turn so history stays whole.
    const aborted = e instanceof Error && e.name === 'AbortError';
    if (insertedTurnId && !aborted) await rollbackSend(insertedTurnId, verdict.conversationId);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `engine unreachable: ${msg}` }, { status: 502 });
  }
  // The engine refused the message → don't leave a dangling user turn in history.
  if (insertedTurnId && !up.ok) await rollbackSend(insertedTurnId, verdict.conversationId);

  if (isEvents && up.ok) {
    return new Response(up.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const outHeaders = new Headers();
  outHeaders.set('Content-Type', up.headers.get('content-type') ?? 'application/json');
  outHeaders.set('Cache-Control', 'no-store');
  const cd = up.headers.get('content-disposition'); if (cd) outHeaders.set('Content-Disposition', cd);
  return new Response(up.body, { status: up.status, headers: outHeaders });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
