/**
 * Serial in-process job queue for learning work. Restart-safe without a broker:
 * state lives in the DB (conversations.extracted_at, import_jobs.status) and
 * `resumePending()` re-enqueues unfinished work on boot.
 */
import { and, eq, isNull, ne, inArray } from 'drizzle-orm';
import { db, conversations, turns, importJobs, interviewAnswers } from '@opersona/db';
import { extractFromConversation } from './extractReasoning.js';
import { writeEpisode } from './episodes.js';
import { recomputeFingerprint } from './fingerprint.js';
import { runImport } from './importClaude.js';
import { publishSnapshot } from '../persona/assemble.js';

type Job =
  | { kind: 'extract'; orgId: string; cloneId: string; conversationId: string }
  | { kind: 'import'; importId: string }
  | { kind: 'refresh'; orgId: string; cloneId: string }
  | { kind: 'interview_extract'; orgId: string; cloneId: string; answerId: string };
const q: Job[] = []; let running = false;
const queuedKeys = new Set<string>();
const key = (j: Job) => j.kind === 'extract' ? `x:${j.conversationId}` : j.kind === 'import' ? `i:${j.importId}` : j.kind === 'interview_extract' ? `a:${j.answerId}` : `r:${j.cloneId}`;

export function enqueue(j: Job): void {
  const k = key(j); if (queuedKeys.has(k)) return; queuedKeys.add(k); q.push(j); void pump();
}
export function queueSize(): number { return q.length + (running ? 1 : 0); }

async function pump(): Promise<void> {
  if (running) return; running = true;
  try {
    while (q.length) {
      const j = q.shift()!; queuedKeys.delete(key(j));
      try { await run(j); } catch (e) { console.error('[learning]', j.kind, e instanceof Error ? e.message : e); }
    }
  } finally { running = false; }
}

async function run(j: Job): Promise<void> {
  if (j.kind === 'extract') {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, j.conversationId)).limit(1);
    if (!conv || conv.extractedAt) return;
    // Only the OWNER's words teach the persona: a visitor's conversation (or a persona-test chat)
    // must never leak someone else's reasoning into this fingerprint.
    const { clones } = await import('@opersona/db');
    const [ownerRow] = await db.select({ owner: clones.ownerUserId, kind: clones.kind }).from(clones).where(eq(clones.id, j.cloneId)).limit(1);
    // Imported and hired personas never learn — they are copies/specialists, not the user.
    if (!ownerRow || ownerRow.kind !== 'member') {
      await db.update(conversations).set({ extractedAt: new Date() }).where(eq(conversations.id, j.conversationId));
      return;
    }
    if (conv.mode === 'clone' || (ownerRow && conv.userId !== ownerRow.owner)) {
      // Owner persona-test chats still leave an episode (what was worked on) even though
      // their reasoning is never extracted; a visitor's conversation leaves nothing.
      if (ownerRow && conv.userId === ownerRow.owner) await episodeSafe(j);
      await db.update(conversations).set({ extractedAt: new Date() }).where(eq(conversations.id, j.conversationId));
      return;
    }
    const n = await db.select({ id: turns.id }).from(turns).where(eq(turns.conversationId, j.conversationId));
    if (n.length < 2) { await db.update(conversations).set({ extractedAt: new Date() }).where(eq(conversations.id, j.conversationId)); return; }
    const out = await extractFromConversation(j.orgId, j.cloneId, j.conversationId);
    await episodeSafe(j); // episodic memory rides the same extraction pass, AFTER reasoning extraction
    await db.update(conversations).set({ extractedAt: new Date() }).where(eq(conversations.id, j.conversationId));
    console.log(`[learning] extracted ${out.observations.length} observation(s) from ${j.conversationId}: ${out.note}`);
    await refresh(j.orgId, j.cloneId);
  } else if (j.kind === 'import') {
    await runImport(j.importId);
  } else if (j.kind === 'interview_extract') {
    const { extractInterviewAnswer } = await import('../interview/extractAnswer.js');
    const r = await extractInterviewAnswer(j.orgId, j.cloneId, j.answerId);
    console.log(`[learning] interview answer ${j.answerId}: ${r.status} (${r.note})`);
  } else {
    await refresh(j.orgId, j.cloneId);
  }
}

/** Episode failures must never block extraction bookkeeping. */
async function episodeSafe(j: { orgId: string; cloneId: string; conversationId: string }): Promise<void> {
  try {
    const r = await writeEpisode(j.orgId, j.cloneId, j.conversationId);
    console.log(`[learning] episode for ${j.conversationId}: ${r.wrote ? `wrote "${r.title}"` : r.reason}`);
  } catch (e) {
    console.error('[learning] episode', j.conversationId, e instanceof Error ? e.message : e);
  }
}

export async function refresh(orgId: string, cloneId: string): Promise<void> {
  await recomputeFingerprint(orgId, cloneId);
  await publishSnapshot(orgId, cloneId);
}

/** On boot: idle/closed conversations never extracted, and imports left running/queued. */
export async function resumePending(): Promise<void> {
  const convs = await db.select({ id: conversations.id, orgId: conversations.orgId, cloneId: conversations.cloneId })
    .from(conversations).where(and(isNull(conversations.extractedAt), ne(conversations.status, 'live')));
  for (const c of convs) enqueue({ kind: 'extract', orgId: c.orgId, cloneId: c.cloneId, conversationId: c.id });
  const imps = await db.select({ id: importJobs.id }).from(importJobs).where(inArray(importJobs.status, ['queued', 'running']));
  for (const i of imps) enqueue({ kind: 'import', importId: i.id });
  // 'failed' is retried too: a transient rail outage (bridge offline for a
  // minute) must not permanently orphan an answer — one fresh attempt per boot.
  const answers = await db.select({ id: interviewAnswers.id, orgId: interviewAnswers.orgId, cloneId: interviewAnswers.cloneId })
    .from(interviewAnswers).where(and(inArray(interviewAnswers.extractionStatus, ['pending', 'failed']), eq(interviewAnswers.skipped, false)));
  for (const a of answers) enqueue({ kind: 'interview_extract', orgId: a.orgId, cloneId: a.cloneId, answerId: a.id });
  if (convs.length || imps.length || answers.length) console.log(`[learning] resumed ${convs.length} extraction(s), ${imps.length} import(s), ${answers.length} interview answer(s)`);
}
