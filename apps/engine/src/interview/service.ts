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
import { BANK, CORE_KEYS, CORE_TOTAL } from './bank.js';
import { loadInterviewState, storeCoverage, type InterviewState } from './state.js';
import { pickNext, FOLLOW_UP_MAX_AGE, type Candidate } from './nextQuestion.js';

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
  /** The core interview: one real answer in each of the ten areas. `done` counts covered areas. */
  core: { done: number; total: number; complete: boolean };
}

export interface ServeOptions {
  /** true = the person asked to go deeper: the whole bank, follow-ups and probes.
   *  false/absent = the core interview only; once it's complete nothing is served. */
  deepen?: boolean;
}

/** Areas with at least one substantive answer — the definition of "core done". */
function coreOf(state: InterviewState): Progress['core'] {
  const done = state.coverageList.filter((c) => c.answered > 0).length;
  return { done, total: CORE_TOTAL, complete: done >= CORE_TOTAL };
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
    core: coreOf(state),
  };
}

const serve = (q: { id: string; category: string; facet: string | null; kind: string; text: string; hint: string | null }): ServedQuestion => ({
  id: q.id, category: q.category as InterviewCategory, categoryLabel: CATEGORY_LABEL[q.category as InterviewCategory] ?? q.category,
  facet: q.facet, kind: q.kind as ServedQuestion['kind'], text: q.text, hint: q.hint,
});

/** Pick (or resume) the question to show. Materializes bank questions lazily. */
export async function nextQuestionFor(orgId: string, cloneId: string, opts: ServeOptions = {}): Promise<{ question: ServedQuestion | null; progress: Progress; repeat?: boolean; ready?: boolean }> {
  const state = await loadInterviewState(cloneId);
  const core = coreOf(state);
  // The core is done and nobody asked for more: the persona is Ready, and the
  // honest answer is "nothing to do" — not the 51st question. (An unfinished
  // question from a deeper session waits for the next deeper session.)
  if (core.complete && !opts.deepen) return { question: null, progress: await progressFor(state, cloneId), ready: true };

  // Resume: an asked-but-unanswered question is THE question (pause = just leave).
  const [open] = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'asked')))
    .orderBy(desc(interviewQuestions.askedAt)).limit(1);
  // repeat: this exact question was served before and never finished — the
  // interviewer must SAY so (and offer a skip) instead of rewording it as new.
  if (open) return { question: serve(open), progress: await progressFor(state, cloneId), repeat: true };

  // Hygiene: a follow-up whose parent answer has scrolled out of the recent
  // window is stale — the moment has passed, and dredging it up weeks later is
  // exactly what "keeps asking about the same thing" felt like.
  const liveParents = (state.recentAnswerIds ?? []).slice(0, FOLLOW_UP_MAX_AGE);
  await db.update(interviewQuestions).set({ status: 'retired' })
    .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'pending'), eq(interviewQuestions.kind, 'follow_up'),
      liveParents.length ? notInArray(interviewQuestions.parentAnswerId, liveParents) : sql`true`));

  const pending = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'pending')))
    .orderBy(asc(interviewQuestions.createdAt));
  const usedBankKeys = new Set(
    (await db.select({ bankKey: interviewQuestions.bankKey }).from(interviewQuestions)
      .where(eq(interviewQuestions.cloneId, cloneId))).map((r) => r.bankKey).filter(Boolean),
  );

  const toCandidate = (b: (typeof BANK)[number]): Candidate => ({
    bankKey: b.bankKey, category: b.category, facet: b.facet,
    kind: 'behavioural' as const, priority: 0, text: b.text, intensity: b.intensity,
  });
  let candidates: Candidate[];
  if (opts.deepen) {
    candidates = [
      ...pending.map((p) => ({
        id: p.id, category: p.category as InterviewCategory, facet: p.facet,
        kind: p.kind as Candidate['kind'], priority: p.priority, text: p.text, parentAnswerId: p.parentAnswerId,
      })),
      ...BANK.filter((b) => !usedBankKeys.has(b.bankKey)).map(toCandidate),
    ];
  } else {
    // Core mode: only the areas without a real answer yet, one designated
    // question each — or, if that one was skipped, any other opener in the area.
    const uncovered = new Set(state.coverageList.filter((c) => c.answered === 0).map((c) => c.category));
    candidates = [...uncovered].flatMap((cat) => {
      const designated = BANK.find((b) => b.bankKey === CORE_KEYS[cat]);
      if (designated && !usedBankKeys.has(designated.bankKey)) return [toCandidate(designated)];
      return BANK.filter((b) => b.category === cat && !usedBankKeys.has(b.bankKey)).map(toCandidate);
    });
    // Nothing left to ask in the uncovered areas (every opener skipped): the core is as done as it can be.
    if (!candidates.length) return { question: null, progress: await progressFor(state, cloneId), ready: true };
  }
  const winner = pickNext(candidates, state);
  if (!winner) return { question: null, progress: await progressFor(state, cloneId) };

  if (winner.id) {
    await db.update(interviewQuestions).set({ status: 'asked', askedAt: new Date() }).where(eq(interviewQuestions.id, winner.id));
    // One dig per thread: serving a follow-up retires its siblings, so an answer
    // is never mined for a second, third, fourth question about the same story.
    if (winner.kind === 'follow_up' && winner.parentAnswerId) {
      await db.update(interviewQuestions).set({ status: 'retired' })
        .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'pending'),
          eq(interviewQuestions.parentAnswerId, winner.parentAnswerId), sql`${interviewQuestions.id} <> ${winner.id}`));
    }
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
  deepen?: boolean;
}): Promise<{ answerId: string | null; question: ServedQuestion | null; progress: Progress; ready?: boolean; justReady?: boolean }> {
  const [q] = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.id, a.questionId), eq(interviewQuestions.cloneId, a.cloneId), eq(interviewQuestions.orgId, a.orgId))).limit(1);
  if (!q) throw new Error('question not found');
  if (q.status === 'answered' || q.status === 'skipped') throw new Error('already answered — ask for the next question');
  // Measured BEFORE this answer lands, so the tenth area's arrival is visible as a moment.
  const coreBefore = coreOf(await loadInterviewState(a.cloneId)).complete;
  const text = a.userText.trim();
  const skipped = !text;
  const [ans] = await db.insert(interviewAnswers).values({
    orgId: a.orgId, cloneId: a.cloneId, questionId: q.id, category: q.category, questionText: q.text,
    text, skipped,
    context: { intent: q.intent, threadDepth: q.kind === 'behavioural' ? 0 : 1, ...(a.dialogue?.length ? { dialogue: a.dialogue.map((m) => ({ role: m.role === 'user' ? 'user' : 'interviewer', text: m.text.slice(0, 2000) })).slice(0, 24) } : {}) },
    extractionStatus: skipped ? 'skipped' : 'pending',
    ...(skipped ? { extractedAt: new Date() } : {}),
  }).returning({ id: interviewAnswers.id });
  await db.update(interviewQuestions).set({ status: skipped ? 'skipped' : 'answered' }).where(eq(interviewQuestions.id, q.id));
  if (!skipped) enqueue({ kind: 'interview_extract', orgId: a.orgId, cloneId: a.cloneId, answerId: ans!.id });
  await storeCoverage(a.orgId, a.cloneId);
  const next = await nextQuestionFor(a.orgId, a.cloneId, { deepen: a.deepen });
  // The moment the tenth area lands, the persona is Ready — say so once, loudly.
  const justReady = !coreBefore && next.progress.core.complete;
  // Every 5th completed answer, the batch also feeds "How I think": the answers
  // are mined as a transcript for reasoning patterns (visible style, not claims).
  if (!skipped && next.progress.answered > 0 && next.progress.answered % 5 === 0) {
    enqueue({ kind: 'interview_fingerprint', orgId: a.orgId, cloneId: a.cloneId, batch: next.progress.answered / 5 });
  }
  return { answerId: skipped ? null : ans!.id, ...next, ...(justReady ? { justReady: true } : {}) };
}
