/**
 * Interview orchestration — what the routes call. The interview CONVERSATION
 * runs on claude.ai (the connector's `opersona_me` tools); this module serves
 * the deterministic side: `nextQuestionFor` is resume-safe (an already-asked,
 * unanswered question is returned again) and `submitThread` lands a completed
 * exchange, queues the async extraction, and returns the next question.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db, interviewAnswers, interviewQuestions, traits, memories, contextualRules } from '@opersona/db';
import { CATEGORY_LABEL, type InterviewCategory } from '@opersona/shared';
import { enqueue } from '../learning/queue.js';
import { BANK } from './bank.js';
import { loadInterviewState, storeCoverage, type InterviewState } from './state.js';
import { pickNext, type Candidate } from './nextQuestion.js';

export interface ServedQuestion {
  id: string;
  category: InterviewCategory;
  categoryLabel: string;
  facet: string | null;
  kind: 'behavioural' | 'follow_up' | 'contradiction';
  text: string;
  hint: string | null;
}

export interface Progress {
  categories: { category: InterviewCategory; label: string; coverage: number; answered: number; justStarted: boolean }[];
  answered: number;
  knowledge: { memories: number; traits: number; rules: number };
}

async function progressFor(state: InterviewState, cloneId: string): Promise<Progress> {
  const [answeredRow] = await db.select({ n: sql<number>`count(*)::int` }).from(interviewAnswers)
    .where(and(eq(interviewAnswers.cloneId, cloneId), eq(interviewAnswers.skipped, false)));
  const counts = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(memories).where(and(eq(memories.cloneId, cloneId), notInArray(memories.status, ['retired', 'disputed']))),
    db.select({ n: sql<number>`count(*)::int` }).from(traits).where(and(eq(traits.cloneId, cloneId), notInArray(traits.status, ['retired', 'disputed']))),
    db.select({ n: sql<number>`count(*)::int` }).from(contextualRules).where(and(eq(contextualRules.cloneId, cloneId), notInArray(contextualRules.status, ['retired', 'disputed']))),
  ]);
  return {
    categories: state.coverageList.map((c) => ({
      category: c.category, label: CATEGORY_LABEL[c.category], coverage: c.coverage, answered: c.answered, justStarted: c.justStarted,
    })),
    answered: answeredRow?.n ?? 0,
    knowledge: { memories: counts[0][0]?.n ?? 0, traits: counts[1][0]?.n ?? 0, rules: counts[2][0]?.n ?? 0 },
  };
}

const serve = (q: { id: string; category: string; facet: string | null; kind: string; text: string; hint: string | null }): ServedQuestion => ({
  id: q.id, category: q.category as InterviewCategory, categoryLabel: CATEGORY_LABEL[q.category as InterviewCategory] ?? q.category,
  facet: q.facet, kind: q.kind as ServedQuestion['kind'], text: q.text, hint: q.hint,
});

/** Pick (or resume) the question to show. Materializes bank questions lazily. */
export async function nextQuestionFor(orgId: string, cloneId: string): Promise<{ question: ServedQuestion | null; progress: Progress; repeat?: boolean }> {
  // Resume: an asked-but-unanswered question is THE question (pause = just leave).
  const [open] = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'asked')))
    .orderBy(desc(interviewQuestions.askedAt)).limit(1);
  const state = await loadInterviewState(cloneId);
  // repeat: this exact question was served before and never finished — the
  // interviewer must SAY so (and offer a skip) instead of rewording it as new.
  if (open) return { question: serve(open), progress: await progressFor(state, cloneId), repeat: true };

  const pending = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'pending')))
    .orderBy(asc(interviewQuestions.createdAt));
  const usedBankKeys = new Set(
    (await db.select({ bankKey: interviewQuestions.bankKey }).from(interviewQuestions)
      .where(eq(interviewQuestions.cloneId, cloneId))).map((r) => r.bankKey).filter(Boolean),
  );

  const candidates: Candidate[] = [
    ...pending.map((p) => ({
      id: p.id, category: p.category as InterviewCategory, facet: p.facet,
      kind: p.kind as Candidate['kind'], priority: p.priority, text: p.text,
    })),
    ...BANK.filter((b) => !usedBankKeys.has(b.bankKey)).map((b) => ({
      bankKey: b.bankKey, category: b.category, facet: b.facet,
      kind: 'behavioural' as const, priority: 0, text: b.text, intensity: b.intensity,
    })),
  ];
  const winner = pickNext(candidates, state);
  if (!winner) return { question: null, progress: await progressFor(state, cloneId) };

  if (winner.id) {
    await db.update(interviewQuestions).set({ status: 'asked', askedAt: new Date() }).where(eq(interviewQuestions.id, winner.id));
    const [rowQ] = await db.select().from(interviewQuestions).where(eq(interviewQuestions.id, winner.id)).limit(1);
    return { question: serve(rowQ!), progress: await progressFor(state, cloneId) };
  }
  const bank = BANK.find((b) => b.bankKey === winner.bankKey)!;
  const [ins] = await db.insert(interviewQuestions).values({
    orgId, cloneId, category: bank.category, facet: bank.facet, text: bank.text, hint: bank.hint ?? null,
    kind: 'behavioural', source: 'bank', bankKey: bank.bankKey, status: 'asked', askedAt: new Date(),
  }).onConflictDoNothing() // arbiter-less: the partial (clone_id, bank_key) unique index can't be inferred as a target
    .returning();
  if (!ins) {
    // Raced with another materialization of the same bank key — serve whatever exists.
    const [existing] = await db.select().from(interviewQuestions)
      .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.bankKey, winner.bankKey!))).limit(1);
    return { question: existing ? serve(existing) : null, progress: await progressFor(state, cloneId) };
  }
  return { question: serve(ins), progress: await progressFor(state, cloneId) };
}

/**
 * Submit a whole interview exchange conducted ELSEWHERE (claude.ai over MCP:
 * their own fast Claude plays the interviewer). The user's verbatim words are
 * the quotable answer; the dialogue rides as context. Same materialization,
 * same extraction pipeline, next question returned so the interviewer flows on.
 */
export async function submitThread(a: {
  orgId: string; cloneId: string; questionId: string; userText: string;
  dialogue?: { role: string; text: string }[];
}): Promise<{ answerId: string | null; question: ServedQuestion | null; progress: Progress }> {
  const [q] = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.id, a.questionId), eq(interviewQuestions.cloneId, a.cloneId), eq(interviewQuestions.orgId, a.orgId))).limit(1);
  if (!q) throw new Error('question not found');
  if (q.status === 'answered' || q.status === 'skipped') throw new Error('already answered — ask for the next question');
  const text = a.userText.trim();
  const skipped = !text;
  const [ans] = await db.insert(interviewAnswers).values({
    orgId: a.orgId, cloneId: a.cloneId, questionId: q.id, category: q.category, questionText: q.text,
    text, skipped,
    context: { intent: q.intent, ...(a.dialogue?.length ? { dialogue: a.dialogue.map((m) => ({ role: m.role === 'user' ? 'user' : 'interviewer', text: m.text.slice(0, 2000) })).slice(0, 24) } : {}) },
    extractionStatus: skipped ? 'skipped' : 'pending',
    ...(skipped ? { extractedAt: new Date() } : {}),
  }).returning({ id: interviewAnswers.id });
  await db.update(interviewQuestions).set({ status: skipped ? 'skipped' : 'answered' }).where(eq(interviewQuestions.id, q.id));
  if (!skipped) enqueue({ kind: 'interview_extract', orgId: a.orgId, cloneId: a.cloneId, answerId: ans!.id });
  await storeCoverage(a.orgId, a.cloneId);
  const next = await nextQuestionFor(a.orgId, a.cloneId);
  return { answerId: skipped ? null : ans!.id, ...next };
}
