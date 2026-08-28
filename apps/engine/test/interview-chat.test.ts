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
/** Replies now compute in the BACKGROUND (bridge-reality) — wait for the worker to land. */
const settle = () => new Promise((r) => setTimeout(r, 600));

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

  it('send returns immediately (awaitingReply) and the reply lands in the background', async () => {
    if (!enabled) return;
    railMock({ reply: 'Two weeks, wow. What made you sure?', action: 'continue' });
    const before = await interviewChatState(ORG, CLONE);
    const s = await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'I once moved cities on two weeks notice.' });
    expect(s.awaitingReply).toBe(true); // send never blocks on the model
    // (with an instant mock the background reply may already be in `s.messages` — real rails take seconds)
    await settle();
    const after = await interviewChatState(ORG, CLONE);
    expect(after.question?.id).toBe(before.question?.id);
    expect(after.awaitingReply).toBe(false);
    const last = after.messages[after.messages.length - 1]!;
    expect(last.role).toBe('interviewer');
    expect(last.text).toContain('What made you sure?');
  });

  it('a wrap_up materializes the answer (user side only, dialogue as context) and opens the next question', async () => {
    if (!enabled) return;
    railMock({ reply: 'Got it — that says a lot.', action: 'wrap_up' });
    const before = await interviewChatState(ORG, CLONE);
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'Because staying felt like slowly disappearing.' });
    await settle(); await flushQueue();
    const s = await interviewChatState(ORG, CLONE);
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

  it('double texts while it thinks are coalesced into one more pass', async () => {
    if (!enabled) return;
    let calls = 0;
    vi.mocked(structuredCall).mockImplementation(async (args: { kind?: string }) => {
      if (args.kind === 'interview-chat') {
        calls++;
        await new Promise((r) => setTimeout(r, 200)); // slow enough for a second send to land mid-think
        return { reply: `reply ${calls}`, action: 'continue' };
      }
      return EMPTY_EXTRACTION;
    });
    await interviewChatState(ORG, CLONE);
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'first thought' });
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'oh and also this' });
    await settle(); await settle();
    expect(calls).toBe(2); // one pass, then exactly one more for the double text — not one per message racing
    const s = await interviewChatState(ORG, CLONE);
    const tail = s.messages.slice(-4).map((m) => `${m.role}:${m.text}`);
    expect(tail.join('|')).toContain('reply 2'); // the second pass saw the full thread
  });

  it('a flaky rail stays present and keeps the thread open — never a cold wrap', async () => {
    if (!enabled) return;
    railMock('throw');
    const before = await interviewChatState(ORG, CLONE);
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'Honestly this is a hard one for me right now.' });
    await settle();
    const s = await interviewChatState(ORG, CLONE);
    expect(s.question!.id).toBe(before.question!.id); // same thread, still open
    const last = s.messages[s.messages.length - 1]!;
    expect(last.role).toBe('interviewer');
    expect(last.text).toContain('I did read what you said');
    // Nothing was wrapped: no answer row materialized for this thread yet.
    const [ans] = await db.select().from(interviewAnswers)
      .where(and(eq(interviewAnswers.cloneId, CLONE), eq(interviewAnswers.questionId, before.question!.id))).limit(1);
    expect(ans).toBeUndefined();
    // A second failure does NOT parrot the same apology again.
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'go on mate' });
    await settle();
    const s2 = await interviewChatState(ORG, CLONE);
    const apologies = s2.messages.filter((m) => m.text.includes('I did read what you said'));
    expect(apologies.length).toBe(1);
    // Recovery: the rail comes back, a wrap works, the thread closes with ALL user messages captured.
    railMock({ reply: 'That sounds heavy. Thank you for trusting me with it.', action: 'wrap_up' });
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'Yeah. Anyway, that is where I am.' });
    await settle(); await flushQueue();
    const s3 = await interviewChatState(ORG, CLONE);
    expect(s3.question!.id).not.toBe(before.question!.id);
    const [wrapped] = await db.select().from(interviewAnswers)
      .where(and(eq(interviewAnswers.cloneId, CLONE), eq(interviewAnswers.questionId, before.question!.id))).limit(1);
    expect(wrapped!.text).toContain('hard one for me right now');
    expect(wrapped!.text).toContain('go on mate');
    expect(wrapped!.text).toContain('where I am');
  });

  it('NO rail at all says so honestly and keeps the thread open', async () => {
    if (!enabled) return;
    vi.mocked(structuredCall).mockImplementation(async (args: { kind?: string }) => {
      if (args.kind === 'interview-chat') throw new Error('no_api_key: connect your Claude in Settings');
      return EMPTY_EXTRACTION;
    });
    const before = await interviewChatState(ORG, CLONE);
    await sendInterviewChat({ orgId: ORG, cloneId: CLONE, text: 'hello?' });
    await settle();
    const s = await interviewChatState(ORG, CLONE);
    expect(s.question!.id).toBe(before.question!.id); // NOT wrapped — waiting for a rail
    const last = s.messages[s.messages.length - 1]!;
    expect(last.role).toBe('interviewer');
    expect(last.text).toContain('brain isn’t connected');
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
