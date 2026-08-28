/**
 * MBTI-style personality test: 24 Likert items (6 per axis), balanced so half the
 * items are keyed toward each pole. Scores are -100..+100 per axis (negative =
 * first letter, positive = second: E-I, S-N, T-F, J-P). Deliberately framed as
 * self-report ("personality lens"), not science — it colours the persona's voice,
 * it never overrides learned reasoning patterns.
 */
export type Axis = 'EI' | 'SN' | 'TF' | 'JP';
export interface MbtiItem { id: string; axis: Axis; text: string; keyed: -1 | 1 } // -1 → first pole (E/S/T/J)

export const MBTI_ITEMS: MbtiItem[] = [
  // E (−) vs I (+)
  { id: 'ei1', axis: 'EI', text: 'Talking a problem through with someone gives me energy.', keyed: -1 },
  { id: 'ei2', axis: 'EI', text: 'After a day full of meetings or calls, I need time alone to recharge.', keyed: 1 },
  { id: 'ei3', axis: 'EI', text: 'I think out loud — my ideas take shape as I say them.', keyed: -1 },
  { id: 'ei4', axis: 'EI', text: 'I prefer to work something out fully in my head before sharing it.', keyed: 1 },
  { id: 'ei5', axis: 'EI', text: 'In a new group I am usually one of the first to speak.', keyed: -1 },
  { id: 'ei6', axis: 'EI', text: 'Written messages suit me better than impromptu conversations.', keyed: 1 },
  // S (−) vs N (+)
  { id: 'sn1', axis: 'SN', text: 'I trust concrete facts and direct observation over hunches.', keyed: -1 },
  { id: 'sn2', axis: 'SN', text: 'I am more interested in what could be than in what is.', keyed: 1 },
  { id: 'sn3', axis: 'SN', text: 'When learning something new, I want real examples before theory.', keyed: -1 },
  { id: 'sn4', axis: 'SN', text: 'I often notice patterns and connections others miss.', keyed: 1 },
  { id: 'sn5', axis: 'SN', text: 'Step-by-step instructions suit me better than a rough vision.', keyed: -1 },
  { id: 'sn6', axis: 'SN', text: 'I get restless doing routine work even when it is useful.', keyed: 1 },
  // T (−) vs F (+)
  { id: 'tf1', axis: 'TF', text: 'When deciding, being right matters more to me than being kind.', keyed: -1 },
  { id: 'tf2', axis: 'TF', text: 'I weigh how a decision will make people feel as much as whether it is correct.', keyed: 1 },
  { id: 'tf3', axis: 'TF', text: 'I would rather hear blunt criticism than softened feedback.', keyed: -1 },
  { id: 'tf4', axis: 'TF', text: 'Keeping harmony in a group is worth some inefficiency.', keyed: 1 },
  { id: 'tf5', axis: 'TF', text: 'I judge ideas on logic first, even ideas from people I like.', keyed: -1 },
  { id: 'tf6', axis: 'TF', text: 'People come to me with personal problems more than technical ones.', keyed: 1 },
  // J (−) vs P (+)
  { id: 'jp1', axis: 'JP', text: 'I like decisions settled; open questions nag at me.', keyed: -1 },
  { id: 'jp2', axis: 'JP', text: 'I prefer to keep options open as long as possible.', keyed: 1 },
  { id: 'jp3', axis: 'JP', text: 'I plan my work ahead rather than figuring it out as I go.', keyed: -1 },
  { id: 'jp4', axis: 'JP', text: 'Deadlines are when my best work suddenly happens.', keyed: 1 },
  { id: 'jp5', axis: 'JP', text: 'A tidy plan matters more to me than a flexible one.', keyed: -1 },
  { id: 'jp6', axis: 'JP', text: 'I happily change course mid-way when something better appears.', keyed: 1 },
];

export const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'] as const;

export interface MbtiResult { type: string; scores: Record<Axis, number> } // -100..100, negative → E/S/T/J

/** The quick take: 3 items per axis (~90 seconds). Same fixed instrument, fewer
 *  samples — retakes with the full 24 refine the confidence, not the meaning. */
export const MBTI_QUICK_IDS = ['ei1', 'ei2', 'ei3', 'sn1', 'sn2', 'sn3', 'tf1', 'tf2', 'tf3', 'jp1', 'jp2', 'jp3'] as const;
export const MBTI_QUICK_ITEMS: MbtiItem[] = MBTI_ITEMS.filter((i) => (MBTI_QUICK_IDS as readonly string[]).includes(i.id));

/** answers: itemId → 1..5 (Likert). Scores whatever subset was answered, normalised
 *  per axis; every axis needs at least 3 answered items (the quick take's floor). */
export function scoreMbti(answers: Record<string, number>): MbtiResult {
  const sums: Record<Axis, number> = { EI: 0, SN: 0, TF: 0, JP: 0 };
  const counts: Record<Axis, number> = { EI: 0, SN: 0, TF: 0, JP: 0 };
  for (const item of MBTI_ITEMS) {
    const a = answers[item.id];
    if (a == null) continue;
    if (a < 1 || a > 5) throw new Error(`bad answer for ${item.id}`);
    sums[item.axis] += (a - 3) * item.keyed; // -2..2 toward the keyed pole
    counts[item.axis] += 1;
  }
  for (const axis of Object.keys(counts) as Axis[]) {
    if (counts[axis] < 3) throw new Error(`too few answers on ${axis} (${counts[axis]}; need at least 3)`);
  }
  const scores = Object.fromEntries((Object.entries(sums) as [Axis, number][]).map(([k, v]) => [k, Math.round((v / (counts[k as Axis] * 2)) * 100)])) as Record<Axis, number>;
  const type = (scores.EI < 0 ? 'E' : 'I') + (scores.SN < 0 ? 'S' : 'N') + (scores.TF < 0 ? 'T' : 'F') + (scores.JP < 0 ? 'J' : 'P');
  return { type, scores };
}

export const AXIS_POLES: Record<Axis, [string, string]> = { EI: ['Extraversion', 'Introversion'], SN: ['Sensing', 'Intuition'], TF: ['Thinking', 'Feeling'], JP: ['Judging', 'Perceiving'] };

/** All 16 four-letter types — for people who already know theirs and just type it in. */
export const MBTI_TYPES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
] as const;

/** Direction-only sentinel scores (±1) for a STATED type: the pole is known, the
 *  strength is not. Renderers must branch on `source === 'stated'` and never show
 *  these as percentages — inventing strengths would break the no-fake-numbers rule. */
export function statedScores(type: string): Record<Axis, number> {
  return {
    EI: type[0] === 'E' ? -1 : 1,
    SN: type[1] === 'S' ? -1 : 1,
    TF: type[2] === 'T' ? -1 : 1,
    JP: type[3] === 'J' ? -1 : 1,
  };
}

/** Prompt/export line for a stated type: poles spelled out, no invented strengths. */
export function describeStatedMbti(type: string): string {
  const poles = [
    AXIS_POLES.EI[type[0] === 'E' ? 0 : 1],
    AXIS_POLES.SN[type[1] === 'S' ? 0 : 1],
    AXIS_POLES.TF[type[2] === 'T' ? 0 : 1],
    AXIS_POLES.JP[type[3] === 'J' ? 0 : 1],
  ];
  return `${type} — ${poles.join(', ')} (stated directly; per-axis strengths not measured)`;
}

/** Short prompt-facing description; strength wording scales with |score|. */
export function describeMbti(r: MbtiResult): string {
  const strength = (v: number) => (Math.abs(v) >= 60 ? 'strongly' : Math.abs(v) >= 25 ? 'moderately' : 'slightly');
  const lines = (Object.entries(r.scores) as [Axis, number][]).map(([axis, v]) => {
    const [a, b] = AXIS_POLES[axis];
    const pole = v < 0 ? a : b;
    return `${pole} (${strength(v)}, ${Math.abs(v)}%)`;
  });
  return `${r.type} — ${lines.join(', ')}`;
}
