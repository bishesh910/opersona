/**
 * The anti-circling contract: a re-served (asked-but-unfinished) question is
 * flagged `repeat: true` so the interviewer names it instead of rewording it;
 * an empty-text submit SKIPS the question permanently and the next serve is a
 * DIFFERENT question with no repeat flag.
 * Writes rows → runs only against a *_scratch/_test DB (or RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../src/llm.js', () => ({ structuredCall: vi.fn(), textCall: vi.fn() }));
vi.mock('../src/keys.js', () => ({ orgModelConfig: vi.fn(async () => ({ apiKey: 'k', chatModel: 'c', extractModel: 'e', condenseModel: 'h' })) }));

import { and, eq } from 'drizzle-orm';
import { db, pool, clones, interviewQuestions } from '@opersona/db';
import { nextQuestionFor, submitThread } from '../src/interview/service.js';

const ORG = `org_test_${randomUUID().slice(0, 8)}`;
const CLONE = randomUUID();
let enabled = false;

beforeAll(async () => {
  const name = (await pool.query('select current_database() as d').catch(() => null))?.rows?.[0]?.d as string | undefined;
  enabled = process.env.RUN_DB_TESTS === '1' || /_scratch$|_test$/.test(name ?? '');
  if (!enabled) return;
  await db.insert(clones).values({ id: CLONE, orgId: ORG, ownerUserId: `u_${ORG}`, name: 'Circle Tester', kind: 'member' });
});

afterAll(async () => {
  if (!enabled) return;
  for (const t of ['interview_answers', 'interview_questions', 'interview_coverage', 'learning_events', 'persona_snapshots', 'clones'])
    await pool.query(`delete from ${t} where org_id = $1`, [ORG]);
});

describe('interview resume + skip (anti-circling)', () => {
  it('flags a re-served question as repeat, and skip retires it for good', async () => {
    if (!enabled) return;
    const first = await nextQuestionFor(ORG, CLONE);
    expect(first.question).not.toBeNull();
    expect(first.repeat).toBeUndefined(); // fresh serve is not a repeat

    const again = await nextQuestionFor(ORG, CLONE);
    expect(again.question?.id).toBe(first.question!.id); // resume-safe: same question…
    expect(again.repeat).toBe(true);                     // …but honestly labelled

    // Empty text = skip: retires the question, serves a different one.
    const afterSkip = await submitThread({ orgId: ORG, cloneId: CLONE, questionId: first.question!.id, userText: '' });
    expect(afterSkip.answerId).toBeNull();
    expect(afterSkip.question).not.toBeNull();
    expect(afterSkip.question!.id).not.toBe(first.question!.id);

    // The skipped question never comes back.
    const next = await nextQuestionFor(ORG, CLONE);
    expect(next.question!.id).not.toBe(first.question!.id);

    // Double-submit of a retired question is refused.
    await expect(submitThread({ orgId: ORG, cloneId: CLONE, questionId: first.question!.id, userText: 'late answer' }))
      .rejects.toThrow(/already/);
  });
});

describe('interview evidence confirms patterns directly (product decision)', () => {
  it('one interview-sourced observation → confirmed; one ordinary observation → emerging', async () => {
    if (!enabled) return;
    const { reasoningObservations } = await import('@opersona/db');
    const { recomputeFingerprint } = await import('../src/learning/fingerprint.js');
    await db.insert(reasoningObservations).values([
      { orgId: ORG, cloneId: CLONE, patternKey: 'test_interview_move', dimension: 'risk', description: 'Builds a buffer before committing to risk.', evidence: [{ quote: 'fund first' }], weight: 1, sourceKind: 'import', sourceRef: 'claude-chat:interview-batch-abc-1' },
      { orgId: ORG, cloneId: CLONE, patternKey: 'test_plain_move', dimension: 'pace', description: 'Explores broadly before narrowing.', evidence: [{ quote: 'looked around' }], weight: 1, sourceKind: 'import', sourceRef: 'claude-chat:cc-dist-xyz' },
    ]);
    const rows = await recomputeFingerprint(ORG, CLONE);
    expect(rows.find((r) => r.patternKey === 'test_interview_move')?.status).toBe('confirmed');
    expect(rows.find((r) => r.patternKey === 'test_plain_move')?.status).toBe('emerging');
    await pool.query("delete from reasoning_observations where org_id = $1", [ORG]);
    await pool.query("delete from reasoning_patterns where org_id = $1", [ORG]);
  });
});

describe('one dig per thread (no "asking about it again and again")', () => {
  it('a follow-up waits for the cooldown, then serves once and retires its siblings', async () => {
    if (!enabled) return;
    const served = await nextQuestionFor(ORG, CLONE);
    expect(served.question).not.toBeNull();
    const answered = await submitThread({ orgId: ORG, cloneId: CLONE, questionId: served.question!.id, userText: 'A concrete story with a why, long enough to count.' });
    const parent = answered.answerId!;

    // Two follow-ups grow out of that answer (what extraction would insert).
    const mk = (text: string, priority: number) => db.insert(interviewQuestions).values({
      orgId: ORG, cloneId: CLONE, category: 'work', facet: 'ambition', text, kind: 'follow_up', source: 'generated',
      status: 'pending', parentAnswerId: parent, priority,
    }).returning({ id: interviewQuestions.id }).then((r) => r[0]!.id);
    const strong = await mk('Since that early win, have you gone looking for lead roles again?', 0.9);
    const weak = await mk('Who on that team did you learn the most from, and how?', 0.4);

    // Right after the parent answer: NOT the follow-up.
    const next1 = answered.question!;
    expect([strong, weak]).not.toContain(next1.id);
    const a1 = await submitThread({ orgId: ORG, cloneId: CLONE, questionId: next1.id, userText: 'Another concrete story, different topic entirely.' });
    // One turn later: still held back.
    expect([strong, weak]).not.toContain(a1.question!.id);
    const a2 = await submitThread({ orgId: ORG, cloneId: CLONE, questionId: a1.question!.id, userText: 'And a third story, to let the thread breathe.' });

    // Cooldown over: the strongest follow-up is served ONCE, and its sibling is retired.
    expect(a2.question!.id).toBe(strong);
    expect(a2.question!.kind).toBe('follow_up');
    const [sibling] = await db.select({ status: interviewQuestions.status }).from(interviewQuestions).where(eq(interviewQuestions.id, weak));
    expect(sibling!.status).toBe('retired');

    // Answering the follow-up never brings the thread back: nothing pending remains for that parent.
    await submitThread({ orgId: ORG, cloneId: CLONE, questionId: strong, userText: 'Yes, once, and it went fine.' });
    const left = await db.select({ id: interviewQuestions.id }).from(interviewQuestions)
      .where(and(eq(interviewQuestions.parentAnswerId, parent), eq(interviewQuestions.status, 'pending')));
    expect(left).toHaveLength(0);
  });
});
