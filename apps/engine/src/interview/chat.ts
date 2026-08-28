/**
 * Chat-style interview — the persona MESSAGES its human instead of handing
 * them a form. Short exchanges: the interviewer (condense model — cheap, fast)
 * reacts, probes once, and knows when a thread has what it needs; then the
 * deterministic picker chooses what to explore next, exactly as before.
 *
 * The chat is a CAPTURE layer, nothing more: when a thread wraps, the user's
 * side materializes into an interview_answers row and rides the existing
 * extraction pipeline (quotes stay verifiable against their own words; the
 * full dialogue travels as context so short replies stay interpretable).
 * A model failure never stalls the conversation — it wraps with a plain
 * acknowledgment and moves on.
 */
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, interviewMessages, interviewQuestions, interviewAnswers, clones, personaBriefs } from '@opersona/db';
import { redactSecrets } from '@opersona/shared';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { enqueue } from '../learning/queue.js';
import { knownDigest, storeCoverage } from './state.js';
import { nextQuestionFor, type Progress, type ServedQuestion } from './service.js';

export const MAX_USER_MESSAGES_PER_THREAD = 5;
/** Bridge jobs (the user's own machine thinking) routinely need 10-20s — a chat
 *  can breathe behind typing dots; a cold fallback after a heartfelt message
 *  cannot. */
export const CHAT_TIMEOUT_MS = 25_000;

export const ChatTurn = z.object({
  reply: z.string().min(1).max(320).describe('your next message — 1-3 short sentences, one probe at most'),
  action: z.enum(['continue', 'wrap_up']).describe("wrap_up when this thread has a concrete moment AND the why behind it (usually after 2-4 of their messages), or they signal they're done — then reply is only a brief warm close, never a new question"),
});
export type ChatTurnT = z.infer<typeof ChatTurn>;

const CHAT_SYSTEM = (name: string) => `You are ${name}'s persona-in-training, texting the real ${name} to learn who they are. You asked the CURRENT QUESTION; they are answering in chat messages.

How to text:
- 1-3 short sentences. Sound like a curious friend, not an interviewer, never a therapist. Mirror their energy and length — if they write two words, don't write four lines.
- ONE probe at a time, and only when it earns its place: the why, what they weighed, what they were afraid of, whether they'd do it again, whether there's an exception, whether it changes when someone close is involved.
- React like you heard them ("Two weeks' notice, wow") before you probe. Never analyse them to their face; never use words like trait, pattern, data, model.

When it gets heavy — and this matters more than any other rule:
- If they share something raw, scary, or unresolved (stuck, afraid, struggling right now), be a person FIRST: name the weight simply and sincerely ("that's a lot to carry", "no wonder you feel stuck") before anything else. Never brush past it, never sound clinical.
- A live dilemma is the most valuable thread there is. STAY on it. Never change the subject away from something raw, and never wrap_up while they are mid-struggle or right after they asked you something.
- If they ask YOU what to do, don't dodge and don't pretend: you're still learning how they think, so you can't call it for them yet — say that warmly, then turn it into the useful thing: ask what each option would actually mean for them, what they're most afraid of losing, what the person they trust most would say. Answering their question with honest curiosity IS the help you can give.

Also:
- KNOWN THINGS is context so you don't re-ask what you know. If something they say sits oddly against it, you may ask ONE curious question about what makes the situations different — never a gotcha.
- wrap_up when the thread has a concrete story plus the reason underneath (usually 2-4 of their messages), or they give short done-signals. On wrap_up the reply is a short warm close for THIS topic only ("Got it — that says a lot.") — the system brings the next question, not you.
- Never invent things about them. Never promise anything. Their words are the point; yours are just the nudge.`;

const greet = (name: string) =>
  `Hey — it's your persona. The more of you I actually know, the better I get at being you. Mind if I ask you things here now and then? Short answers are fine — this is a chat, not a form.`;

export interface ChatMessage { id: string; role: 'interviewer' | 'user'; text: string; questionId: string; createdAt: string }
export interface ChatState { question: ServedQuestion | null; messages: ChatMessage[]; progress: Progress }

const toMsg = (m: typeof interviewMessages.$inferSelect): ChatMessage =>
  ({ id: m.id, role: m.role, text: m.text, questionId: m.questionId, createdAt: m.createdAt.toISOString() });

async function recentMessages(cloneId: string, limit = 40): Promise<ChatMessage[]> {
  const rows = await db.select().from(interviewMessages).where(eq(interviewMessages.cloneId, cloneId))
    .orderBy(desc(interviewMessages.createdAt)).limit(limit);
  return rows.reverse().map(toMsg);
}

async function say(orgId: string, cloneId: string, questionId: string, text: string): Promise<void> {
  await db.insert(interviewMessages).values({ orgId, cloneId, questionId, role: 'interviewer', text });
}

/** Ensure there is an open question WITH an interviewer opener in the stream. */
export async function interviewChatState(orgId: string, cloneId: string): Promise<ChatState> {
  const next = await nextQuestionFor(orgId, cloneId);
  if (next.question) {
    const [existing] = await db.select({ id: interviewMessages.id }).from(interviewMessages)
      .where(and(eq(interviewMessages.cloneId, cloneId), eq(interviewMessages.questionId, next.question.id))).limit(1);
    if (!existing) {
      const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(interviewMessages).where(eq(interviewMessages.cloneId, cloneId));
      if (total === 0) {
        const [brief] = await db.select({ name: personaBriefs.displayName }).from(personaBriefs).where(eq(personaBriefs.cloneId, cloneId)).limit(1);
        const [clone] = await db.select({ name: clones.name }).from(clones).where(eq(clones.id, cloneId)).limit(1);
        await say(orgId, cloneId, next.question.id, greet(brief?.name || clone?.name || 'me'));
      }
      await say(orgId, cloneId, next.question.id, next.question.text + (next.question.hint ? `\n${next.question.hint}` : ''));
    }
  }
  return { question: next.question, messages: await recentMessages(cloneId), progress: next.progress };
}

/** Wrap the open thread: user side → an interview_answers row → the existing pipeline. */
async function finalizeThread(orgId: string, cloneId: string, question: typeof interviewQuestions.$inferSelect, opts: { skipped?: boolean } = {}): Promise<void> {
  const thread = await db.select().from(interviewMessages)
    .where(and(eq(interviewMessages.cloneId, cloneId), eq(interviewMessages.questionId, question.id)))
    .orderBy(asc(interviewMessages.createdAt));
  const userText = thread.filter((m) => m.role === 'user').map((m) => m.text.trim()).filter(Boolean).join('\n\n');
  const skipped = opts.skipped === true || !userText;
  const [ans] = await db.insert(interviewAnswers).values({
    orgId, cloneId, questionId: question.id, category: question.category, questionText: question.text,
    text: userText, skipped,
    context: { intent: question.intent, dialogue: thread.map((m) => ({ role: m.role, text: m.text })) },
    extractionStatus: skipped ? 'skipped' : 'pending',
    ...(skipped ? { extractedAt: new Date() } : {}),
  }).returning({ id: interviewAnswers.id });
  await db.update(interviewQuestions).set({ status: skipped ? 'skipped' : 'answered' }).where(eq(interviewQuestions.id, question.id));
  if (!skipped) enqueue({ kind: 'interview_extract', orgId, cloneId, answerId: ans!.id });
  await storeCoverage(orgId, cloneId);
}

/** One user message in: react (continue) or wrap and move to the next question. Never throws, never stalls. */
export async function sendInterviewChat(a: { orgId: string; cloneId: string; text: string }): Promise<ChatState> {
  // The open thread is whatever question is currently 'asked'.
  const [question] = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.cloneId, a.cloneId), eq(interviewQuestions.status, 'asked')))
    .orderBy(desc(interviewQuestions.askedAt)).limit(1);
  if (!question) return interviewChatState(a.orgId, a.cloneId); // nothing open — reopen and show state

  await db.insert(interviewMessages).values({ orgId: a.orgId, cloneId: a.cloneId, questionId: question.id, role: 'user', text: redactSecrets(a.text).slice(0, 8000) });

  const thread = await db.select().from(interviewMessages)
    .where(and(eq(interviewMessages.cloneId, a.cloneId), eq(interviewMessages.questionId, question.id)))
    .orderBy(asc(interviewMessages.createdAt));
  const userCount = thread.filter((m) => m.role === 'user').length;

  let turn: ChatTurnT | null = null;
  if (userCount < MAX_USER_MESSAGES_PER_THREAD) {
    try {
      turn = await interviewerTurn(a.orgId, a.cloneId, question, thread);
    } catch (e) {
      const noRail = e instanceof Error && e.message.startsWith('no_api_key');
      // Whatever broke, NEVER cold-wrap a thread someone just poured into.
      // Stay present, say what's true, keep the thread open — their words are
      // safe and the conversation resumes exactly here.
      await say(a.orgId, a.cloneId, question.id, noRail
        ? 'I heard you — but my brain isn’t connected yet, so I can’t really talk back. Pair the bridge or add an API key in Settings → Models, then message me again and we’ll pick this right up.'
        : 'Sorry — I lost my train of thought for a second (connection hiccup on my side, not you). I did read what you said. Give me a moment and message me again — even just "go on" — and we’ll pick up right here.');
      const next = await nextQuestionFor(a.orgId, a.cloneId); // still 'asked' → resumes this question
      return { question: next.question, messages: await recentMessages(a.cloneId), progress: next.progress };
    }
  }
  if (!turn) {
    // Thread cap only: they've given a lot — close with gratitude, never with a shrug.
    turn = { reply: 'Okay — that’s a lot of real stuff, thank you. Let me sit with this one.', action: 'wrap_up' };
  }

  if (turn.action === 'continue') {
    await say(a.orgId, a.cloneId, question.id, turn.reply);
    const next = await nextQuestionFor(a.orgId, a.cloneId); // question is still 'asked' → resume returns it
    return { question: next.question, messages: await recentMessages(a.cloneId), progress: next.progress };
  }

  await say(a.orgId, a.cloneId, question.id, turn.reply);
  await finalizeThread(a.orgId, a.cloneId, question);
  return interviewChatState(a.orgId, a.cloneId);
}

/** Skip the open thread (counts as skipped for the picker's suppression). */
export async function skipInterviewChat(orgId: string, cloneId: string): Promise<ChatState> {
  const [question] = await db.select().from(interviewQuestions)
    .where(and(eq(interviewQuestions.cloneId, cloneId), eq(interviewQuestions.status, 'asked')))
    .orderBy(desc(interviewQuestions.askedAt)).limit(1);
  if (question) {
    await say(orgId, cloneId, question.id, 'No problem — different one.');
    await finalizeThread(orgId, cloneId, question, { skipped: true });
  }
  return interviewChatState(orgId, cloneId);
}

async function interviewerTurn(
  orgId: string, cloneIdArg: string,
  question: typeof interviewQuestions.$inferSelect,
  thread: (typeof interviewMessages.$inferSelect)[],
): Promise<ChatTurnT> {
  const cfg = await orgModelConfig(orgId);
  const [brief] = await db.select({ name: personaBriefs.displayName }).from(personaBriefs).where(eq(personaBriefs.cloneId, cloneIdArg)).limit(1);
  const [clone] = await db.select({ name: clones.name }).from(clones).where(eq(clones.id, cloneIdArg)).limit(1);
  const name = brief?.name || clone?.name || 'them';
  const digest = await knownDigest(cloneIdArg, 1500);
  const rendered = thread.map((m) => `${m.role === 'user' ? name.toUpperCase() : 'YOU'}: ${m.text.slice(0, 1500)}`).join('\n');
  const call = structuredCall({
    orgId, cloneId: cloneIdArg, kind: 'interview-chat', apiKey: cfg.apiKey, model: cfg.condenseModel, effort: 'low',
    schema: ChatTurn, system: CHAT_SYSTEM(name),
    user: `KNOWN THINGS (context only):\n${digest}\n\nCURRENT QUESTION (asked by you):\n${question.text}\n\nTHE CHAT SO FAR:\n${rendered}\n\nTheir last message is at the bottom. Continue or wrap up.`,
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CHAT_TIMEOUT_MS).unref?.());
  const out = await Promise.race([call, timeout]);
  if (!out) throw new Error('interviewer timeout');
  return out;
}
