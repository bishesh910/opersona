import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, conversations, clones } from '@opersona/db';
import { portraitPNG, spriteSheetPNG } from '@opersona/pixel-avatar';
import { AvatarRecipe } from '@opersona/shared';
import { config } from '../config.js';
import { sendMessage, endSession } from '../sessions/manager.js';
import { registerDownloads } from './downloads.js';
import { subscribe, turnStartId } from '../sessions/events.js';
import { resolveApproval } from '../sessions/approvals.js';
import { publishSnapshot, activePrompt } from '../persona/assemble.js';
import { recallMemory } from '../persona/retrieval.js';
import { recipeFromSelfie } from '../avatar/fromSelfie.js';
import { ingestDocument } from '../documents/ingest.js';
import { orgModelConfig } from '../keys.js';
import { enqueue, queueSize } from '../learning/queue.js';
import { recomputeFingerprint, setPatternVerdict } from '../learning/fingerprint.js';
import { recordFeedback } from '../learning/feedback.js';
import { exportPersona, exportHireManifest } from '../persona/export.js';
import { exportVault } from '../persona/vault.js';
import { backfillEpisodes } from '../learning/episodes.js';
import { importJobs, ingestTokens, claudeCodeSessions } from '@opersona/db';
import { createHash, randomBytes } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { ingestClaudeCodeSession } from '../learning/claudeCode.js';
import { tidyPatterns } from '../learning/merge.js';
import { createSelfTestBatch, regenerateSelfTests, rateSelfTest, accuracy } from '../learning/selfTest.js';
import Anthropic from '@anthropic-ai/sdk';

export const routes = new Hono();
registerDownloads(routes);

const parse = async <T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> => schema.parse(await c.req.json().catch(() => ({})));

routes.get('/health', (c) => c.json({ ok: true, version: config.version, learningQueue: queueSize() }));
/** Zero-token model access probe: GET /v1/models/{id} with the org's key.
 *  { checkable:false } when the org runs on a bridge (no key to probe with). */
routes.post('/models/check', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), models: z.array(z.string().max(60)).min(1).max(6) }));
  const cfg = await orgModelConfig(body.orgId).catch(() => null);
  if (!cfg || !cfg.apiKey) return c.json({ checkable: false, missing: [] });
  const missing: string[] = [];
  for (const m of [...new Set(body.models)]) {
    try {
      const r = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(m)}`, {
        headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 404) missing.push(m);
    } catch { /* network hiccup: don't block saving */ }
  }
  return c.json({ checkable: true, missing });
});

routes.get('/bridge/status', async (c) => {
  const { bridgeStatus } = await import('../bridge/hub.js');
  return c.json(bridgeStatus(c.req.query('orgId') ?? ''));
});

// ─── chat ───────────────────────────────────────────────────────────────────
routes.post('/conversations/:id/messages', async (c) => {
  const body = await parse(c, z.object({
    orgId: z.string(), userId: z.string(), cloneId: z.string().uuid(), text: z.string().max(50_000),
    attachments: z.array(z.object({ name: z.string().max(200), mime: z.string().max(100), dataBase64: z.string().max(14_000_000) })).max(8).optional(),
  }));
  if (!body.text.trim() && !body.attachments?.length) return c.json({ error: 'empty message' }, 400);
  const id = c.req.param('id');
  const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.orgId, body.orgId), eq(conversations.cloneId, body.cloneId))).limit(1);
  if (!conv) return c.json({ error: 'conversation not found' }, 404);
  await sendMessage({ conversationId: id, ...body, text: body.text.trim() || '(see attachment)' });
  return c.json({ ok: true }, 202);
});

routes.get('/conversations/:id/events', async (c) => {
  const id = c.req.param('id');
  const orgId = c.req.query('orgId') ?? '';
  const [conv] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), eq(conversations.orgId, orgId))).limit(1);
  if (!conv) return c.json({ error: 'conversation not found' }, 404);
  // Reconnects resume via the Last-Event-ID header; fresh mounts may ask for
  // ?after=turn (replay only the in-flight turn) or a numeric cursor.
  const header = c.req.header('last-event-id');
  const afterQ = c.req.query('after');
  const after = header ? (Number(header) || 0)
    : afterQ === 'turn' ? turnStartId(id)
    : Number(afterQ ?? 0) || 0;
  return streamSSE(c, async (stream) => {
    let alive = true;
    const unsub = subscribe(id, (s) => { if (alive) void stream.writeSSE({ id: String(s.id), data: JSON.stringify(s.ev) }); }, after);
    stream.onAbort(() => { alive = false; unsub(); });
    while (alive) { await stream.writeSSE({ event: 'ping', data: '' }); await stream.sleep(15_000); }
  });
});

routes.post('/conversations/:id/settings', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), model: z.string().max(80).nullable().optional(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional() }));
  const id = c.req.param('id');
  const set: Record<string, unknown> = {}; if ('model' in body) set.model = body.model ?? null; if ('effort' in body) set.effort = body.effort ?? null;
  await db.update(conversations).set(set).where(and(eq(conversations.id, id), eq(conversations.orgId, body.orgId)));
  await endSession(id); // next message resumes the transcript under the new model
  return c.json({ ok: true });
});

routes.post('/conversations/:id/end', async (c) => {
  await endSession(c.req.param('id'));
  return c.json({ ok: true });
});

// ─── approvals ──────────────────────────────────────────────────────────────
routes.post('/approvals/:id', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), behavior: z.enum(['allow', 'deny']), updatedInput: z.record(z.string(), z.unknown()).optional(), answer: z.string().optional(), message: z.string().optional() }));
  const ok = await resolveApproval(c.req.param('id'), { behavior: body.behavior, updatedInput: body.updatedInput, answer: body.answer, message: body.message, resolvedBy: body.userId });
  return ok ? c.json({ ok: true }) : c.json({ error: 'approval not pending' }, 404);
});

// ─── avatar ─────────────────────────────────────────────────────────────────
routes.post('/avatar/from-selfie', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), imageBase64: z.string().min(100).max(20_000_000), mime: z.string().regex(/^(image\/[\w.+-]+|application\/octet-stream)$/).max(60) })); // sharp decides decodability; a friendly error covers formats it can't read
  const cfg = await orgModelConfig(body.orgId);
  const out = await recipeFromSelfie({ orgId: body.orgId, apiKey: cfg.apiKey, model: cfg.chatModel, imageBase64: body.imageBase64, mime: body.mime });
  return c.json(out);
});

routes.post('/avatar/render', async (c) => {
  const body = await parse(c, z.object({ recipe: AvatarRecipe, scale: z.number().int().min(1).max(16).optional(), kind: z.enum(['portrait', 'sheet']).optional() }));
  const png = body.kind === 'sheet' ? spriteSheetPNG(body.recipe, body.scale ?? 4) : portraitPNG(body.recipe, body.scale ?? 8);
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' } });
});

// ─── keys ───────────────────────────────────────────────────────────────────
/** Validate an Anthropic API key before the web app stores it (a bad key otherwise
 *  shows up as a multi-minute retry loop inside the SDK subprocess). */
routes.post('/keys/validate', async (c) => {
  const body = await parse(c, z.object({ apiKey: z.string().min(10) }));
  try {
    const client = new Anthropic({ apiKey: body.apiKey, maxRetries: 0 });
    const m = await client.models.retrieve('claude-haiku-4-5');
    return c.json({ ok: true, model: m.id });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    return c.json({ ok: false, status, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});

// ─── persona ────────────────────────────────────────────────────────────────
routes.post('/clones/:id/snapshot', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string() }));
  return c.json(await publishSnapshot(body.orgId, c.req.param('id')));
});

routes.get('/clones/:id/prompt', async (c) => {
  const orgId = c.req.query('orgId') ?? '';
  const [clone] = await db.select({ id: clones.id }).from(clones).where(and(eq(clones.id, c.req.param('id')), eq(clones.orgId, orgId))).limit(1);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  return c.json(await activePrompt(orgId, clone.id));
});

/** Onboarding interview → persona brief, on the cheapest model (condense = haiku
 *  by default) with low effort: a handful of one-line answers become the story. */
routes.post('/clones/:id/compose-brief', async (c) => {
  const body = await parse(c, z.object({
    orgId: z.string(),
    userName: z.string().max(120),
    answers: z.object({
      role: z.string().min(2).max(300),
      knownFor: z.string().max(400).optional(),
      style: z.string().max(300).optional(),
      rules: z.string().max(500).optional(),
    }),
  }));
  const [clone] = await db.select({ id: clones.id }).from(clones).where(and(eq(clones.id, c.req.param('id')), eq(clones.orgId, body.orgId))).limit(1);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const cfg = await orgModelConfig(body.orgId);
  const { structuredCall } = await import('../llm.js');
  const Brief = z.object({
    roleTitle: z.string().max(80).describe('short job title, e.g. "Detection Engineer"'),
    briefMd: z.string().max(900).describe('2-4 first-person sentences: what I do, what people come to me for, how I like to work. Concrete and warm; no corporate fluff, no bullet points.'),
    operatingRules: z.string().max(400).describe('hard rules one per line, ONLY from what the user actually said; empty string when they gave none'),
  });
  const qa = [
    `What do you do: ${body.answers.role}`,
    body.answers.knownFor ? `People come to you for: ${body.answers.knownFor}` : '',
    body.answers.style ? `How you like answers: ${body.answers.style}` : '',
    body.answers.rules ? `Hard rules: ${body.answers.rules}` : '',
  ].filter(Boolean).join('\n');
  const out = await structuredCall({
    orgId: body.orgId, cloneId: clone.id, kind: 'compose-brief',
    apiKey: cfg.apiKey, model: cfg.condenseModel, effort: 'low', schema: Brief,
    system: 'You turn quick interview answers into a work persona brief, written AS the person (first person "I"). Stay strictly faithful to their answers — never invent employers, projects, or skills they did not mention. Match their tone: casual answers get a casual brief.',
    user: `Person: ${body.userName}\n${qa}`,
  });
  return c.json(out);
});

/** claude.ai connector: learn from a conversation the user explicitly saved. */
routes.post('/clones/:id/learn-transcript', async (c) => {
  const body = await parse(c, z.object({
    orgId: z.string(),
    sessionId: z.string().min(8).max(200),
    title: z.string().max(200).optional(),
    turns: z.array(z.object({ role: z.enum(['human', 'assistant']), text: z.string().max(50_000) })).min(2).max(200),
  }));
  const [clone] = await db.select({ id: clones.id }).from(clones).where(and(eq(clones.id, c.req.param('id')), eq(clones.orgId, body.orgId))).limit(1);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const { learnFromPlainTranscript } = await import('../learning/claudeCode.js');
  const r = await learnFromPlainTranscript({ orgId: body.orgId, cloneId: clone.id, sessionId: body.sessionId, title: body.title, transcript: body.turns });
  return c.json(r);
});

/** Owner-grade memory recall for the claude.ai MCP connector (server-to-server only). */
routes.post('/clones/:id/recall', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), query: z.string().min(1).max(500), k: z.number().int().min(1).max(20).optional() }));
  const [clone] = await db.select({ id: clones.id }).from(clones).where(and(eq(clones.id, c.req.param('id')), eq(clones.orgId, body.orgId))).limit(1);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const hits = await recallMemory(clone.id, body.query, undefined, body.k ?? 8, false);
  return c.json({ hits });
});

// ─── learning: fingerprint, feedback, import ────────────────────────────────
/** Extract now from one conversation (usually automatic on session end). */
routes.post('/conversations/:id/extract', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), cloneId: z.string().uuid() }));
  await endSession(c.req.param('id'));
  await db.update(conversations).set({ extractedAt: null }).where(and(eq(conversations.id, c.req.param('id')), eq(conversations.orgId, body.orgId)));
  enqueue({ kind: 'extract', orgId: body.orgId, cloneId: body.cloneId, conversationId: c.req.param('id') });
  return c.json({ ok: true, queued: queueSize() }, 202);
});

routes.post('/clones/:id/fingerprint/recompute', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string() }));
  const patterns = await recomputeFingerprint(body.orgId, c.req.param('id'));
  await publishSnapshot(body.orgId, c.req.param('id'));
  return c.json({ patterns });
});

routes.post('/clones/:id/patterns/:key', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), verdict: z.enum(['accept', 'reject']).nullable() }));
  await setPatternVerdict(c.req.param('id'), c.req.param('key'), body.verdict);
  await recomputeFingerprint(body.orgId, c.req.param('id'));
  await publishSnapshot(body.orgId, c.req.param('id'));
  return c.json({ ok: true });
});

routes.post('/conversations/:id/feedback', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), cloneId: z.string().uuid(), turnId: z.string().uuid(), verdict: z.enum(['me', 'not_me']), comment: z.string().max(2000).optional() }));
  const r = await recordFeedback({ ...body, conversationId: c.req.param('id') });
  return c.json({ ok: true, ...r });
});

/** Web saves the export file to uploads/import-<importId> then calls this. */
routes.post('/imports/:id/start', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string() }));
  const [job] = await db.select().from(importJobs).where(and(eq(importJobs.id, c.req.param('id')), eq(importJobs.orgId, body.orgId))).limit(1);
  if (!job) return c.json({ error: 'import not found' }, 404);
  enqueue({ kind: 'import', importId: job.id });
  return c.json({ ok: true }, 202);
});

// ─── export ─────────────────────────────────────────────────────────────────
routes.get('/clones/:id/export', async (c) => {
  const orgId = c.req.query('orgId') ?? '';
  const kind = c.req.query('kind') ?? 'persona';
  const body = kind === 'hire' ? await exportHireManifest(orgId, c.req.param('id')) : await exportPersona(orgId, c.req.param('id'));
  const fname = kind === 'hire' ? `${body.name}.agent.json` : `${body.name}.persona.json`;
  return new Response(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${fname.replace(/[^A-Za-z0-9._-]/g, '_')}"` } });
});

/** The brain as an Obsidian-ready markdown vault (zip). Owner-only — the web proxy enforces it. */
routes.get('/clones/:id/export-vault', async (c) => {
  const orgId = c.req.query('orgId') ?? '';
  const { buffer, filename } = await exportVault(orgId, c.req.param('id'));
  return new Response(new Uint8Array(buffer), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${filename}"` } });
});

// ─── episodes ───────────────────────────────────────────────────────────────
/** Backfill episodic memory for existing finished conversations (owner's chats, newest first, ≤50). */
routes.post('/clones/:id/episodes/backfill', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), cap: z.number().int().min(1).max(50).optional() }));
  return c.json(await backfillEpisodes(body.orgId, c.req.param('id'), body.cap ?? 50));
});

// ─── fingerprint quality (1b) ───────────────────────────────────────────────
routes.post('/clones/:id/fingerprint/tidy', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string() }));
  return c.json(await tidyPatterns(body.orgId, c.req.param('id')));
});

routes.post('/clones/:id/self-test', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), regenerate: z.boolean().optional() }));
  return c.json(body.regenerate ? await regenerateSelfTests(body.orgId, c.req.param('id')) : await createSelfTestBatch(body.orgId, c.req.param('id')));
});

routes.post('/clones/:id/self-test/:testId/rate', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), verdict: z.enum(['me', 'not_me']), comment: z.string().max(2000).optional() }));
  const r = await rateSelfTest({ orgId: body.orgId, cloneId: c.req.param('id'), id: c.req.param('testId'), verdict: body.verdict, comment: body.comment });
  return c.json({ ok: true, ...r });
});

routes.get('/clones/:id/accuracy', async (c) => {
  return c.json(await accuracy(c.req.param('id')));
});

// ─── Claude Code ────────────────────────────────────────────────────────────
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

/** Create a personal ingest token (shown once). */
routes.post('/clones/:id/claude-code/tokens', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), name: z.string().max(60).optional() }));
  const token = 'ocp_' + randomBytes(24).toString('base64url');
  const [row] = await db.insert(ingestTokens).values({ orgId: body.orgId, cloneId: c.req.param('id'), userId: body.userId, name: body.name ?? 'Claude Code', tokenHash: sha(token) }).returning({ id: ingestTokens.id });
  return c.json({ id: row!.id, token });
});

routes.post('/clones/:id/claude-code/tokens/:tokenId/revoke', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string() }));
  await db.update(ingestTokens).set({ revokedAt: new Date() }).where(and(eq(ingestTokens.id, c.req.param('tokenId')), eq(ingestTokens.cloneId, c.req.param('id')), eq(ingestTokens.orgId, body.orgId)));
  return c.json({ ok: true });
});

/** Upload one or more transcripts from the web app (body: { files: [{ name, text }] }). */
routes.post('/clones/:id/claude-code/upload', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), files: z.array(z.object({ name: z.string().max(200), text: z.string().max(30_000_000) })).min(1).max(50) }));
  const results = [];
  for (const f of body.files) results.push({ name: f.name, ...(await ingestClaudeCodeSession({ orgId: body.orgId, cloneId: c.req.param('id'), jsonl: f.text, source: 'upload', sessionIdHint: f.name.replace(/\.jsonl$/, '') })) });
  return c.json({ results });
});

routes.get('/clones/:id/claude-code/sessions', async (c) => {
  const orgId = c.req.query('orgId') ?? '';
  const rows = await db.select().from(claudeCodeSessions).where(and(eq(claudeCodeSessions.cloneId, c.req.param('id')), eq(claudeCodeSessions.orgId, orgId))).orderBy(desc(claudeCodeSessions.createdAt)).limit(200);
  return c.json({ sessions: rows });
});

// ─── documents ──────────────────────────────────────────────────────────────
routes.post('/documents/:id/ingest', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string() }));
  return c.json({ chunks: await ingestDocument(body.orgId, c.req.param('id')) });
});
