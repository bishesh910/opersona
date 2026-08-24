/**
 * Public-facing ingest endpoint for the Claude Code SessionEnd hook. Authenticated by a
 * personal ingest token (Bearer ocp_…), NOT the internal web↔engine token. The web app
 * proxies this path through without a session so hooks on other machines can reach it.
 */
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, ingestTokens } from '@opersona/db';
import { ingestClaudeCodeSession } from '../learning/claudeCode.js';

export const ingest = new Hono();
const MAX_BYTES = 30 * 1024 * 1024;

ingest.post('/claude-code', async (c) => {
  const h = c.req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token.startsWith('ocp_')) return c.json({ error: 'missing ingest token' }, 401);
  const hash = createHash('sha256').update(token).digest('hex');
  const [t] = await db.select().from(ingestTokens).where(and(eq(ingestTokens.tokenHash, hash), isNull(ingestTokens.revokedAt))).limit(1);
  if (!t) return c.json({ error: 'invalid or revoked token' }, 401);
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > MAX_BYTES) return c.json({ error: 'transcript too large' }, 413);
  const jsonl = await c.req.text();
  if (jsonl.length > MAX_BYTES) return c.json({ error: 'transcript too large' }, 413);
  await db.update(ingestTokens).set({ lastUsedAt: new Date() }).where(eq(ingestTokens.id, t.id));
  const r = await ingestClaudeCodeSession({ orgId: t.orgId, cloneId: t.cloneId, jsonl, source: 'hook', sessionIdHint: c.req.query('session') ?? undefined, project: c.req.query('project') ?? undefined });
  return c.json(r, r.status === 'failed' ? 500 : 200);
});
