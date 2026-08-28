/**
 * The engine proxy's authorization core — every browser→engine call passes
 * through `authorize()`. Kept out of the route file so it is unit-testable
 * (Next route modules may only export handlers).
 *
 * Ownership rules: owners may do everything on their clone; org owner/admin
 * read-only (+ org owner may resolve approvals). Unknown paths 404.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getCloneAccess } from '@/lib/clones';
import { isOrgAdmin, type OrgCtx } from '@/lib/org';

export type Deny = { status: number; error: string };
export type Allow = { ok: true; cloneId?: string; conversationId?: string; conversationTitle?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny = (status: number, error: string): Deny => ({ status, error });

export async function authorize(ctx: OrgCtx, method: string, path: string[]): Promise<Allow | Deny> {
  const [root, id, leaf] = path;
  if (root === 'health' && method === 'GET' && path.length === 1) return { ok: true };
  if (root === 'bridge' && id === 'status' && method === 'GET' && path.length === 2) return { ok: true };

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
    // Chat content is private: only the conversation's author, or the persona's owner
    // reviewing a visitor conversation with THEIR persona. Org admins get no content.
    const contentOk = mine || !!access?.isOwner;
    if (leaf === 'events' && method === 'GET') return contentOk ? { ok: true, cloneId: conv.cloneId, conversationId: conv.id } : deny(403, 'private conversation');
    if (leaf === 'files' && method === 'GET') return contentOk ? { ok: true, cloneId: conv.cloneId, conversationId: conv.id } : deny(403, 'private conversation');
    // Prewarm: boot the session early (no content, no stored turn). Creator only.
    if (leaf === 'prewarm' && method === 'POST') {
      if (!mine) return deny(403, 'not your conversation');
      return { ok: true, cloneId: conv.cloneId, conversationId: conv.id };
    }
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
    // The rendered prompt and full export carry fingerprint evidence (verbatim chat quotes) — owner only.
    if ((leaf === 'prompt' || leaf === 'export') && method === 'GET') return access.isOwner ? { ok: true, cloneId: id } : deny(403, 'owner-only');
    // The vault contains episodic memory + verbatim evidence quotes — strictly owner-only.
    if (leaf === 'export-vault' && method === 'GET') return access.isOwner ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can export the vault');
    // Self-test accuracy is part of the persona's public stats — readable by anyone with access.
    if (leaf === 'accuracy' && method === 'GET') return { ok: true, cloneId: id };
    // Behavioural similarity (blind scenarios) — same visibility as accuracy.
    if (leaf === 'similarity' && method === 'GET') return { ok: true, cloneId: id };
    // Blind prediction tests are the owner testing THEIR model: generation and the open list are owner-only.
    if (leaf === 'scenarios' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can run prediction tests');
    if (leaf === 'scenarios' && method === 'GET') return access.isOwner ? { ok: true, cloneId: id } : deny(403, 'owner-only');
    if (leaf === 'snapshot' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'read-only');
    // Onboarding interview → AI-drafted brief (cheap model). Owner only.
    if (leaf === 'compose-brief' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'read-only');
    // "Does it sound like me?" — generate a fresh 3-problem self-test batch. Owner only.
    if (leaf === 'self-test' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can run self-tests');
    // One-shot behavioural simulation ("what would I do?"). Owner only.
    if (leaf === 'simulate' && method === 'POST') return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can run simulations');
    return deny(404, 'unknown engine path');
  }

  // Rate one self-test answer: clones/:id/self-test/:testId/rate. Owner only.
  if (root === 'clones' && id && UUID.test(id) && path.length === 5 && method === 'POST'
    && path[2] === 'self-test' && path[3] && UUID.test(path[3]) && path[4] === 'rate') {
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can rate self-tests');
  }

  // Blind scenario actions: clones/:id/scenarios/:sid/{answer|skip|correct}. Owner only.
  if (root === 'clones' && id && UUID.test(id) && path.length === 5 && method === 'POST'
    && path[2] === 'scenarios' && path[3] && UUID.test(path[3]) && ['answer', 'skip', 'correct'].includes(path[4] ?? '')) {
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can answer prediction tests');
  }

  // Learn from Claude Code: clones/:id/claude-code/{tokens,upload} and tokens/:tokenId/revoke are owner-only;
  // the sessions list is readable by anyone who can see the persona.
  if (root === 'clones' && id && UUID.test(id) && path[2] === 'claude-code') {
    const [, , , sub, tokenId, tail] = path;
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    if (sub === 'sessions' && method === 'GET' && path.length === 4) return access.isOwner ? { ok: true, cloneId: id } : deny(403, 'owner-only');
    if (method !== 'POST') return deny(404, 'unknown engine path');
    if (!access.canWrite) return deny(403, 'only the persona owner can teach their persona');
    if (path.length === 4 && (sub === 'tokens' || sub === 'upload')) return { ok: true, cloneId: id };
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
    // The cognitive interview is strictly the owner teaching their own persona.
    if (sub === 'interview' && (tail === 'next' || tail === 'answer')) return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can be interviewed');
    return deny(404, 'unknown engine path');
  }

  // Edit an earlier interview answer: clones/:id/interview/answers/:answerId/edit. Owner only.
  if (root === 'clones' && id && UUID.test(id) && path.length === 6 && method === 'POST'
    && path[2] === 'interview' && path[3] === 'answers' && path[4] && UUID.test(path[4]) && path[5] === 'edit') {
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can edit their answers');
  }

  // Verdict on an interview-learned knowledge item: clones/:id/knowledge/:kind/:itemId/verdict. Owner only.
  if (root === 'clones' && id && UUID.test(id) && path.length === 6 && method === 'POST'
    && path[2] === 'knowledge' && ['trait', 'memory', 'rule'].includes(path[3] ?? '') && path[4] && UUID.test(path[4]) && path[5] === 'verdict') {
    const access = await getCloneAccess(ctx, id);
    if (!access) return deny(404, 'clone not found');
    return access.canWrite ? { ok: true, cloneId: id } : deny(403, 'only the persona owner can judge their model');
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
