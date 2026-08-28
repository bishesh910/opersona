/**
 * Chat-interview contract: threads open with an interviewer message, continue
 * turns append replies, wrap-ups materialize the user's side into an
 * interview_answers row (dialogue preserved as context) and open the next
 * question, and a dead rail degrades to a warm wrap — never a stall.
 * Writes rows → runs only against a *_scratch/_test DB (or RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../src/llm.js', () => ({ structuredCall: vi.fn(), textCall: vi.fn() }));
vi.mock('../src/keys.js', () => ({ orgModelConfig: vi.fn(async () => ({ apiKey: 'k', chatModel: 'c', extractModel: 'e', condenseModel: 'h' })) }));

import { structuredCall } from '../src/llm.js';
import { db, pool, clones, interviewMessages, interviewAnswers, interviewQuestions } from '@opersona/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { interviewChatState, sendInterviewChat, skipInterviewChat } from '../src/interview/chat.js';

const ORG = `tst_chat_${randomUUID().slice(0, 8)}`;
const CLONE = randomUUID();
let enabled = false;

const EMPTY_EXTRACTION = { quality: 'thin', memories: [], traits: [], rules: [], tensions: [], contradiction_resolution: null, followup_seeds: [], note: '' };

/** Route the mocked rail by call kind: chat turns vs the async extraction. */
function railMock(chat: { reply: string; action: 'continue' | 'wrap_up' } | 'throw') {
  vi.mocked(structuredCall).mockImplementation(async (args: { kind?: string }) => {
    if (args.kind === 'interview-chat') {
      if (chat === 'throw') throw new Error('rail down');
      return chat;
    }
    return EMPTY_EXTRACTION; // interview-extract and anything else
  });
}

const flushQueue = () => new Promise((r) => setTimeout(r, 250)); // the in-process queue is serial and fast with a mocked rail

beforeAll(async () => {
  const name = (await pool.query('select current_database() as d').catch(() => null))?.rows?.[0]?.d as string | undefined;
  enabled = process.env.RUN_DB_TESTS === '1' || /_scratch$|_test$/.test(name ?? '');
  if (!enabled) return;
  await db.insert(clones).values({ id: CLONE, orgId: ORG, ownerUserId: `u_${ORG}`, name: 'Chat Test', kind: 'member' });
});

afterAll(async () => {
  if (enabled) {
    for (const t of ['interview_messages', 'interview_answers', 'interview_questions', 'interview_coverage', 'memories', 'traits', 'contextual_rules', 'contradictions', 'persona_snapshots', 'learning_events'])
      await pool.query(`delete from ${t} where org_id = $1`, [ORG]);
    await db.delete(clones).where(eq(clones.id, CLONE));
  }
  await pool.end();
});

beforeEach(() => { vi.mocked(structuredCall).mockReset(); });

describe('chat interview', () => {
  it('opens with a greeting + the first question as interviewer messages', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    railMock({ reply: 'x', action: 'continue' });
    const s = await interviewChatState(ORG, CLONE);
    expect(s.question).not.toBeNull();
    const interviewer = s.messages.filter((m) => m.role === 'interviewer');
    expect(interviewer.length).toBe(2); // greeting + question
    expect(interviewer[0]!.text).toContain('your persona');
    expect(interviewer[1]!.text).toContain(s.question!.text.slice(0, 40));
  });

  it('a continue turn appends the interviewer reply and keeps the same question open', async () => {
    if (!enabled) return;
    railMock({ reply: 'Two weeks, wow. What made you sure?', action: 'continue' });
    const before = await interviewChatState(ORG, CLONE);
    const s = await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'I once moved cities on two weeks notice.' });
    expect(s.question?.id).toBe(before.question?.id);
    const last = s.messages[s.messages.length - 1]!;
    expect(last.role).toBe('interviewer');
    expect(last.text).toContain('What made you sure?');
  });

  it('a wrap_up materializes the answer (user side only, dialogue as context) and opens the next question', async () => {
    if (!enabled) return;
    railMock({ reply: 'Got it — that says a lot.', action: 'wrap_up' });
    const before = await interviewChatState(ORG, CLONE);
    const s = await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'Because staying felt like slowly disappearing.' });
    await flushQueue();
    expect(s.question).not.toBeNull();
    expect(s.question!.id).not.toBe(before.question!.id); // moved on
    const [ans] = await db.select().from(interviewAnswers)
      .where(and(eq(interviewAnswers.cloneId, CLONE), eq(interviewAnswers.questionId, before.question!.id))).limit(1);
    expect(ans).toBeTruthy();
    expect(ans!.text).toContain('two weeks notice');
    expect(ans!.text).toContain('slowly disappearing');
    expect(ans!.text).not.toContain('What made you sure?'); // interviewer words never in the quotable text
    expect(ans!.context.dialogue!.some((m) => m.role === 'interviewer')).toBe(true);
    // The new question got its opener in the stream.
    const opener = await db.select().from(interviewMessages)
      .where(and(eq(interviewMessages.cloneId, CLONE), eq(interviewMessages.questionId, s.question!.id))).orderBy(asc(interviewMessages.createdAt));
    expect(opener.length).toBeGreaterThan(0);
    expect(opener[0]!.role).toBe('interviewer');
  });

  it('a dead rail wraps warmly instead of stalling', async () => {
    if (!enabled) return;
    railMock('throw');
    const before = await interviewChatState(ORG, CLONE);
    const s = await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'Honestly not sure what to say.' });
    await flushQueue();
    expect(s.question!.id).not.toBe(before.question!.id); // moved on anyway
    const texts = s.messages.map((m) => m.text);
    expect(texts).toContain('Got it — noted.');
  });

  it('skip finalizes as skipped and serves a different question', async () => {
    if (!enabled) return;
    railMock({ reply: 'x', action: 'continue' });
    const before = await interviewChatState(ORG, CLONE);
    const s = await skipInterviewChat(ORG, CLONE);
    expect(s.question!.id).not.toBe(before.question!.id);
    const [row] = await db.select().from(interviewQuestions).where(eq(interviewQuestions.id, before.question!.id)).limit(1);
    expect(row!.status).toBe('skipped');
    const [ans] = await db.select().from(interviewAnswers)
      .where(and(eq(interviewAnswers.questionId, before.question!.id), inArray(interviewAnswers.cloneId, [CLONE]))).limit(1);
    expect(ans!.skipped).toBe(true);
  });
});
