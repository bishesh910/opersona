/**
 * Authenticated proxy to the engine. The browser never talks to the engine directly:
 * this route checks session + org + clone ownership, injects orgId/userId, adds the
 * internal bearer token, and forwards. `events` is relayed as a live SSE stream.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { and, count, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { redactSecrets } from '@opersona/shared';
import { getSessionCtx, getOrgCtx, isOrgAdmin, type OrgCtx } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { ENGINE_URL, ENGINE_INTERNAL_TOKEN } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ path: string[] }> };
type Deny = { status: number; error: string };
type Allow = { ok: true; cloneId?: string; conversationId?: string; conversationTitle?: string };

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny = (status: number, error: string): Deny => ({ status, error });

/** Ownership rules: owners may do everything on their clone; org owner/admin read-only (+ org owner may resolve approvals). */
async function authorize(ctx: OrgCtx, method: string, path: string[]): Promise<Allow | Deny> {
  const [root, id, leaf] = path;
  if (root === 'health' && method === 'GET' && path.length === 1) return { ok: true };

  if (root === 'avatar' && method === 'POST' && (id === 'from-selfie' || id === 'render') && path.length === 2) return { ok: true };

  if (root === 'conversations' && id && UUID.test(id) && path.length === 3) {
    const [conv] = await db.select().from(schema.conversations)
      .where(and(eq(schema.conversations.id, id), eq(schema.conversations.orgId, ctx.orgId))).limit(1);
    if (!conv) return deny(404, 'conversation not found');
    // "Ask their persona": a same-org member who CREATED this conversation may use it even
    // without clone access (the engine serves them the shareable-only persona).
    const mine = conv.userId === ctx.userId;
    const access = await getCloneAccess(ctx, conv.cloneId);
    if (!access && !mine) return deny(403, 'not your conversation');
    if (leaf === 'events' && method === 'GET') return { ok: true, cloneId: conv.cloneId, conversationId: conv.id };
    if ((leaf === 'messages' || leaf === 'end') && method === 'POST') {
      // Only the conversation's creator writes into it: the owner in their own chats, a visitor
      // in theirs. The owner reviews visitor conversations read-only; org admins stay read-only.
      if (!mine) return deny(403, access ? 'read-only: not your conversation' : 'only the persona owner can chat');
      return { ok: true, cloneId: conv.cloneId, conversationId: conv.id, conversationTitle: conv.title };
    }
    if (leaf === 'settings' && method === 'POST') {
      // Visitors use the org default model — no per-conversation overrides for them.
      if (!access?.canWrite || !mine) return deny(403, 'only the persona owner can change chat settings');
      return { ok: true, cloneId: conv.cloneId, conversationId: conv.id, conversationTitle: conv.title };
    }
    // Learning: "that's me / not me" on a turn, and "learn from this chat now". Owner, own chats only.
    if ((leaf === 'feedback' || leaf === 'extract') && method === 'POST') {
      if (!access?.canWrite || !mine) return deny(403, 'only the persona owner can teach their clone');
      return { ok: true, cloneId: conv.cloneId, conversationId: conv.id };
    }
    return deny(404, 'unknown engine path');
  }

  if (root === 'approvals' && id && UUID.test(id) && method === 'POST' && path.length === 2) {
    const [ap] = await db.select().from(schema.approvals)
      .where(and(eq(schema.approvals.id, id), eq(schema.approvals.orgId, ctx.orgId))).limit(1);
    if (!ap) return deny(404, 'approval not found');
    const access = await getCloneAccess(ctx, ap.cloneId);
    if (!access || !(access.isOwner || ctx.role === 'owner')) return deny(403, 'only the persona owner (or org owner) can resolve approvals');
    return { ok: true, cloneId: ap.cloneId };
  }

  if (root === 'clones' && id && UUID.test(id) && path.length === 3) {
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    if ((leaf === 'prompt' || leaf === 'export') && method === 'GET') return { ok: true, cloneId: id };
    // The vault contains episodic memory + verbatim evidence quotes — strictly owner-only.
    if (leaf === 'export-vault' && method === 'GET') return access.isOwner ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can export the vault');
    // Self-test accuracy is part of the persona's public stats — readable by anyone with access.
    if (leaf === 'accuracy' && method === 'GET') return { ok: true, cloneId: id };
    if (leaf === 'snapshot' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'read-only');
    // "Does it sound like me?" — generate a fresh 3-problem self-test batch. Owner only.
    if (leaf === 'self-test' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can run self-tests');
    return deny(404, 'unknown engine path');
  }

  // Rate one self-test answer: clones/:id/self-test/:testId/rate. Owner only.
  if (root === 'clones' && id && UUID.test(id) && path.length === 5 && method === 'POST'
    && path[2] === 'self-test' && path[3] && UUID.test(path[3]) && path[4] === 'rate') {
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can rate self-tests');
  }

  // Learn from Claude Code: clones/:id/claude-code/{tokens,upload,scan} and tokens/:tokenId/revoke are owner-only;
  // the sessions list is readable by anyone who can see the persona.
  if (root === 'clones' && id && UUID.test(id) && path[2] === 'claude-code') {
    const [, , , sub, tokenId, tail] = path;
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    if (sub === 'sessions' && method === 'GET' && path.length === 4) return { ok: true, cloneId: id };
    if (method !== 'POST') return deny(404, 'unknown engine path');
    if (!access.canWrite) return deny(403, 'only the persona owner can teach their persona');
    if (path.length === 4 && (sub === 'tokens' || sub === 'upload' || sub === 'scan')) return { ok: true, cloneId: id };
    if (path.length === 6 && sub === 'tokens' && tokenId && UUID.test(tokenId) && tail === 'revoke') return { ok: true, cloneId: id };
    return deny(404, 'unknown engine path');
  }

  // Reasoning fingerprint: clones/:id/patterns/:key (verdict) and clones/:id/fingerprint/recompute. Owner only.
  if (root === 'clones' && id && UUID.test(id) && path.length === 4 && method === 'POST') {
    const [, , sub, tail] = path;
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    if (sub === 'patterns' && tail && /^[\w.-]{1,128}$/.test(tail)) return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'read-only');
    if (sub === 'fingerprint' && (tail === 'recompute' || tail === 'tidy')) return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'read-only');
    // Episodic memory backfill for existing conversations. Owner only.
    if (sub === 'episodes' && tail === 'backfill') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can backfill episodes');
    return deny(404, 'unknown engine path');
  }

  // Claude-history import: web inserts the import_jobs row and saves the file, then starts it here.
  if (root === 'imports' && id && UUID.test(id) && leaf === 'start' && method === 'POST' && path.length === 3) {
    const [job] = await db.select().from(schema.importJobs)
      .where(and(eq(schema.importJobs.id, id), eq(schema.importJobs.orgId, ctx.orgId))).limit(1);
    if (!job) return deny(404, 'import not found');
    const access = await getCloneAccess(ctx, job.cloneId);
    if (!access?.canWrite) return deny(403, 'read-only');
    return { ok: true, cloneId: job.cloneId };
  }

  if (root === 'documents' && id && UUID.test(id) && leaf === 'ingest' && method === 'POST' && path.length === 3) {
    const [doc] = await db.select().from(schema.documents)
      .where(and(eq(schema.documents.id, id), eq(schema.documents.orgId, ctx.orgId))).limit(1);
    if (!doc) return deny(404, 'document not found');
    if (doc.cloneId) {
      const access = await getCloneAccess(ctx, doc.cloneId);
      if (!access?.canWrite) return deny(403, 'read-only');
    } else if (!isOrgAdmin(ctx)) return deny(403, 'org KB is admin-only');
    return { ok: true };
  }

  return deny(404, 'unknown engine path');
}

async function handle(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  const s = await getSessionCtx();
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await getOrgCtx(s);
  if (!ctx) return NextResponse.json({ error: 'no organization' }, { status: 403 });

  const verdict = await authorize(ctx, req.method, path);
  if (!('ok' in verdict)) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

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
        // History stores what was attached (names only) — never the bytes.
        const stored = redactSecrets(text) + (attachments.length ? `${text ? '\n' : ''}[attached: ${attachments.map((a) => a.name).join(', ')}]` : '');
        const convId = verdict.conversationId;
        insertedTurnId = await db.transaction(async (tx) => {
          const [t] = await tx.insert(schema.turns)
            .values({ conversationId: convId, orgId: ctx.orgId, role: 'user', content: stored })
            .returning({ id: schema.turns.id });
          const patch: Partial<typeof schema.conversations.$inferInsert> = { lastActivityAt: new Date(), status: 'live' };
          // Auto-title: the first user message names an untitled conversation.
          if (verdict.conversationTitle != null && isDefaultTitle(verdict.conversationTitle)) {
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
    if (insertedTurnId) await db.delete(schema.turns).where(eq(schema.turns.id, insertedTurnId)).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `engine unreachable: ${msg}` }, { status: 502 });
  }
  // The engine refused the message → don't leave a dangling user turn in history.
  if (insertedTurnId && !up.ok) await db.delete(schema.turns).where(eq(schema.turns.id, insertedTurnId)).catch(() => {});

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
