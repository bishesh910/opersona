/**
 * Fingerprint aggregator — pure code, no model. Turns observations into patterns:
 *
 *   strength(pattern) = Σ weight_i · 0.5^(age_days_i / HALF_LIFE)     (negative weights subtract)
 *   n_sources         = distinct conversations that showed it with positive weight
 *
 * A pattern is CONFIRMED when it has been seen in ≥ MIN_SOURCES independent
 * conversations with strength ≥ MIN_STRENGTH, when the human accepted it, or when it
 * came from the human's own explicit feedback ("Not me — I'd have said …") — a typed
 * correction IS a human verdict, it never waits for repetition.
 * A human "reject" wins over everything. Emerging patterns are stored and shown in
 * the UI but NEVER rendered into the prompt — silence beats a wrong stereotype.
 */
import { eq, sql } from 'drizzle-orm';
import { db, reasoningObservations, reasoningPatterns, type ReasoningDimension } from '@opersona/db';

export const HALF_LIFE_DAYS = 90;
export const MIN_SOURCES = 3;
export const MIN_STRENGTH = 1.8;

export interface PatternRow {
  patternKey: string; dimension: ReasoningDimension; description: string; strength: number; nSources: number;
  status: 'emerging' | 'confirmed' | 'rejected'; userVerdict: 'accept' | 'reject' | null; examples: string[]; firstSeenAt: Date; lastSeenAt: Date;
}

export async function recomputeFingerprint(orgId: string, cloneId: string, now = new Date()): Promise<PatternRow[]> {
  const obs = await db.select().from(reasoningObservations).where(eq(reasoningObservations.cloneId, cloneId));
  const verdicts = new Map((await db.select({ k: reasoningPatterns.patternKey, v: reasoningPatterns.userVerdict }).from(reasoningPatterns).where(eq(reasoningPatterns.cloneId, cloneId))).map((r) => [r.k, r.v]));

  const acc = new Map<string, { dim: ReasoningDimension; descs: Map<string, number>; strength: number; sources: Set<string>; examples: string[]; first: Date; last: Date; fromFeedback: boolean; fromInterview: boolean }>();
  for (const o of obs) {
    const ageDays = Math.max(0, (now.getTime() - o.createdAt.getTime()) / 86_400_000);
    const w = o.weight * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    let a = acc.get(o.patternKey);
    if (!a) { a = { dim: o.dimension, descs: new Map(), strength: 0, sources: new Set(), examples: [], first: o.createdAt, last: o.createdAt, fromFeedback: false, fromInterview: false }; acc.set(o.patternKey, a); }
    a.strength += w;
    if (o.sourceKind === 'feedback' && o.weight > 0) a.fromFeedback = true;
    // The owner's word confirms directly (product decision): a move shown in
    // their own interview answers doesn't wait for two more witnesses.
    if (o.weight > 0 && o.sourceRef.startsWith('claude-chat:interview-batch-')) a.fromInterview = true;
    a.descs.set(o.description, (a.descs.get(o.description) ?? 0) + Math.max(0, w));
    if (o.weight > 0) { a.sources.add(o.sourceRef); for (const e of o.evidence) if (a.examples.length < 6 && !a.examples.includes(e.quote)) a.examples.push(e.quote); }
    if (o.createdAt < a.first) a.first = o.createdAt;
    if (o.createdAt > a.last) a.last = o.createdAt;
  }

  const rows: PatternRow[] = [];
  for (const [key, a] of acc) {
    const description = [...a.descs.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
    const verdict = verdicts.get(key) ?? null;
    const status: PatternRow['status'] = verdict === 'reject' ? 'rejected' : verdict === 'accept' ? 'confirmed'
      : a.fromFeedback || a.fromInterview ? 'confirmed'
      : (a.sources.size >= MIN_SOURCES && a.strength >= MIN_STRENGTH) ? 'confirmed' : 'emerging';
    rows.push({ patternKey: key, dimension: a.dim, description, strength: Math.round(a.strength * 100) / 100, nSources: a.sources.size, status, userVerdict: verdict, examples: a.examples, firstSeenAt: a.first, lastSeenAt: a.last });
  }

  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.insert(reasoningPatterns).values({ orgId, cloneId, ...r, updatedAt: now })
        .onConflictDoUpdate({ target: [reasoningPatterns.cloneId, reasoningPatterns.patternKey], set: {
          dimension: r.dimension, description: r.description, strength: r.strength, nSources: r.nSources, status: r.status, examples: r.examples, lastSeenAt: r.lastSeenAt, updatedAt: now,
        } });
    }
  });
  return rows.sort((x, y) => y.strength - x.strength);
}

export async function setPatternVerdict(cloneId: string, patternKey: string, verdict: 'accept' | 'reject' | null): Promise<void> {
  await db.update(reasoningPatterns).set({ userVerdict: verdict, updatedAt: new Date() })
    .where(sql`${reasoningPatterns.cloneId} = ${cloneId} and ${reasoningPatterns.patternKey} = ${patternKey}`);
}

const DIM_LABEL: Record<ReasoningDimension, string> = {
  decomposition: 'How they break problems down', starting_point: 'Where they start', information: 'What they ask for and trust',
  verification: 'How they check themselves', explanation: 'How they want things explained', risk: 'How they treat risk', pace: 'Pace and scope', other: 'Other',
};

/** The prompt section. Confirmed patterns only, grouped by dimension, sorted by strength, deterministic. */
export function renderFingerprint(name: string, patterns: PatternRow[]): string {
  const confirmed = patterns.filter((p) => p.status === 'confirmed').sort((a, b) => a.dimension.localeCompare(b.dimension) || b.strength - a.strength || a.patternKey.localeCompare(b.patternKey));
  if (!confirmed.length) return '';
  const out: string[] = [`## How ${name} thinks (learned from their own reasoning — apply this to NEW problems)`,
    `Before working on anything, decide how ${name} would approach it using the patterns below, then work that way and explain that way. Do not look for a past answer to copy; reproduce the method.`, ''];
  let cur: ReasoningDimension | '' = '';
  for (const p of confirmed) {
    if (p.dimension !== cur) { cur = p.dimension; out.push(`**${DIM_LABEL[cur]}**`); }
    out.push(`- ${p.description}`);
  }
  return out.join('\n');
}
