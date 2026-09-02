/**
 * VOICE — how this person actually writes, learned from their own interview
 * answers. Deterministic and quote-free: counted habits, never an LLM's
 * impression, so it can't invent a personality. A habit is only claimed when
 * it shows up across MULTIPLE answers (one "hmm" is a mood, not a voice).
 *
 * This fills the style layer the prompt has always promised ("match their
 * communication style") and never had.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, interviewAnswers, styleProfiles, type StyleDimensionValue } from '@opersona/db';

const MARKERS: { key: string; label: string; re: RegExp }[] = [
  { key: 'hedges', label: 'hedges and thinks out loud ("hmm", "well", "i guess", "kinda")', re: /\b(hmm+|well|i guess|kinda|sorta|maybe|probably|i think)\b/gi },
  { key: 'idk', label: 'says "idk" / "not sure" rather than guessing', re: /\b(idk|dunno|not sure|no idea)\b/gi },
  { key: 'ellipsis', label: 'trails off mid-thought with "…"', re: /\.{2,}|…/g },
  { key: 'lowercase_i', label: 'types casually — lowercase "i", little punctuation', re: /(^|\s)i(\s|'|$)/g },
  { key: 'profanity', label: 'swears when something matters', re: /\b(fuck\w*|shit|damn|crap|hell)\b/gi },
  { key: 'emphasis', label: 'uses caps or repetition for emphasis', re: /\b[A-Z]{3,}\b|!{2,}/g },
  { key: 'questions_back', label: 'asks back / checks the question before answering', re: /\?\s*$|^(what|huh|sorry|which)\b/gim },
  { key: 'contractions', label: 'contractions everywhere ("dont", "id", "youre")', re: /\b(dont|doesnt|cant|wont|id|ive|im|youre|thats|its)\b/gi },
];

/** Recompute from ALL answers (cheap, no model call) and store the prose block. */
export async function updateVoiceProfile(orgId: string, cloneId: string): Promise<string> {
  const rows = await db.select({ text: interviewAnswers.text }).from(interviewAnswers)
    .where(and(eq(interviewAnswers.cloneId, cloneId), eq(interviewAnswers.skipped, false)));
  const texts = rows.map((r) => r.text.trim()).filter((t) => t.length > 1);
  if (texts.length < 3) return '';

  const words = texts.map((t) => t.split(/\s+/).length);
  const avgWords = Math.round(words.reduce((a, b) => a + b, 0) / words.length);
  const shortShare = words.filter((w) => w <= 12).length / words.length;

  const habits: string[] = [];
  for (const m of MARKERS) {
    const answersWithIt = texts.filter((t) => (t.match(m.re)?.length ?? 0) > 0).length;
    // Claimed only when it recurs: 2+ answers AND a fifth of them.
    if (answersWithIt >= 2 && answersWithIt / texts.length >= 0.2) habits.push(m.label);
  }

  const lengthLine = avgWords <= 18
    ? `Writes SHORT — around ${avgWords} words per answer, often a single line. Long paragraphs are not their register.`
    : avgWords <= 45
      ? `Writes in short paragraphs — around ${avgWords} words when they explain something.`
      : `Writes at length when engaged — around ${avgWords} words, thinking on the page.`;
  const bursts = shortShare >= 0.4 ? ' Frequently answers in bursts of a few words, then adds more if asked.' : '';

  const md = [
    lengthLine + bursts,
    habits.length ? `Verbal habits worth imitating: ${habits.join('; ')}.` : '',
    'Sound like this in their voice — same register, same shortness, same hedges. Never smooth it into polished corporate prose; a tidied-up version of them is not them.',
  ].filter(Boolean).join(' ');

  const dimensions: Partial<Record<'communication' | 'verbosity', StyleDimensionValue>> = {
    communication: { value: habits, n: texts.length, confidence: Math.min(0.9, 0.4 + texts.length / 40), examples: [] },
    verbosity: { value: String(avgWords), score: avgWords, n: texts.length, confidence: Math.min(0.9, 0.4 + texts.length / 40), examples: [] },
  };
  await db.insert(styleProfiles).values({ cloneId, orgId, dimensions, renderedMd: md, version: 1 })
    .onConflictDoUpdate({ target: styleProfiles.cloneId, set: { dimensions, renderedMd: md, updatedAt: new Date(), version: sql`${styleProfiles.version} + 1` } });
  return md;
}
