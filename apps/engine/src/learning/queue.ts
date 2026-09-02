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
  | { kind: 'interview_extract'; orgId: string; cloneId: string; answerId: string }
  | { kind: 'interview_fingerprint'; orgId: string; cloneId: string; batch: number };
const q: Job[] = []; let running = false;
const queuedKeys = new Set<string>();
const key = (j: Job) => j.kind === 'extract' ? `x:${j.conversationId}` : j.kind === 'import' ? `i:${j.importId}` : j.kind === 'interview_extract' ? `a:${j.answerId}` : j.kind === 'interview_fingerprint' ? `f:${j.cloneId}:${j.batch}` : `r:${j.cloneId}`;

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
    // Voice: how they actually write, recounted from every answer. No model call.
    try {
      const { updateVoiceProfile } = await import('../interview/voice.js');
      await updateVoiceProfile(j.orgId, j.cloneId);
    } catch (e) { console.error('[learning] voice profile failed', e); }
  } else if (j.kind === 'interview_fingerprint') {
    // The interview feeds "How I think" too: answers are real writing where the
    // person's reasoning is VISIBLE (not just claimed) — mined with the same
    // verbatim-quote discipline as any transcript. Batched per 5 answers;
    // sessionId is deterministic so re-runs dedupe.
    const batchAnswers = await db.select({ q: interviewAnswers.questionText, a: interviewAnswers.text })
      .from(interviewAnswers)
      .where(and(eq(interviewAnswers.cloneId, j.cloneId), eq(interviewAnswers.skipped, false)))
      .orderBy(interviewAnswers.createdAt)
      .offset((j.batch - 1) * 5).limit(5);
    if (batchAnswers.length < 2) return;
    const transcript = batchAnswers.flatMap((r) => [
      { role: 'assistant' as const, text: r.q },
      { role: 'human' as const, text: r.a },
    ]);
    const { learnFromPlainTranscript } = await import('./claudeCode.js');
    const r = await learnFromPlainTranscript({
      orgId: j.orgId, cloneId: j.cloneId,
      sessionId: `interview-batch-${j.cloneId.slice(0, 8)}-${j.batch}`,
      title: `Interview answers ${(j.batch - 1) * 5 + 1}–${(j.batch - 1) * 5 + batchAnswers.length}`,
      transcript,
    });
    console.log(`[learning] interview fingerprint batch ${j.batch}: ${r.status} (${r.observations ?? 0} observations)`);
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

/** When a bridge CONNECTS, drain this org's rail-outage casualties: interview
 *  answers that failed while no Claude was reachable get one fresh attempt the
 *  moment one is. (Engine-boot resume alone kept retrying into the same dead
 *  rail; this is the event that actually changes the odds.) */
export async function retryRailFailures(orgId: string): Promise<number> {
  const answers = await db.select({ id: interviewAnswers.id, cloneId: interviewAnswers.cloneId })
    .from(interviewAnswers)
    .where(and(eq(interviewAnswers.orgId, orgId), eq(interviewAnswers.extractionStatus, 'failed'), eq(interviewAnswers.skipped, false)));
  if (answers.length) {
    console.log(`[learning] retrying ${answers.length} failed interview extraction(s) for org=${orgId}`);
    for (const a of answers) enqueue({ kind: 'interview_extract', orgId, cloneId: a.cloneId, answerId: a.id });
  }
  // Failed scenario judges drain on the same signal (fired async — each judge is
  // its own inference call; counting them up front keeps this fast).
  const { predictionScenarios } = await import('@opersona/db');
  const { isNotNull } = await import('drizzle-orm');
  const failedJudges = await db.select({ id: predictionScenarios.id }).from(predictionScenarios)
    .where(and(eq(predictionScenarios.orgId, orgId), eq(predictionScenarios.status, 'failed'), isNotNull(predictionScenarios.humanAnswer)));
  if (failedJudges.length) {
    void import('./scenarios.js').then((m) => m.rejudgeFailedScenarios(orgId)).catch((e) => console.error('[scenarios] rejudge sweep failed', e));
  }
  return answers.length + failedJudges.length;
}
