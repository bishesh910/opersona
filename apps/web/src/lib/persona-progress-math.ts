/**
 * The build-meter arithmetic, in ONE pure client-safe place — the server lib,
 * the nav guide panel, and the connector menu all derive from this, so the
 * number and its breakdown can never disagree. It is a BUILD meter (how much
 * of the journey is done), not an accuracy score: accuracy is the blind-test
 * similarity metric, which refuses to show a number under 5 scored scenarios.
 */
export interface ProgressData {
  pct: number;
  connector: boolean;
  answered: number;
  coveragePct: number;   // 0..100, interview coverage average over ALL ten areas (depth, informational)
  coreDone: number;      // 0..10 — life areas with one real answer (the core interview)
  patterns: number;      // confirmed reasoning patterns
  scored: number;        // scored blind scenarios
  bridgePaired: boolean;
  /** interview answers whose extraction FAILED (usually: no Claude rail was
   *  reachable). They retry automatically when a bridge connects. */
  failedExtractions: number;
}

export interface ProgressParts {
  connector: number;  // /20 — connector added on claude.ai
  started: number;    // /10 — first interview answer
  core: number;       // /40 — the core interview: one real answer in each of the ten areas (4 per area)
  patterns: number;   // /10 — confirmed thinking patterns (full credit at 3)
  scored: number;     // /15 — blind tests scored (full credit at 5)
  depth: number;      // /5  — answers beyond the core (full credit at 10 extra)
  pct: number;        // rounded, capped total
}

/** Sized so that ONE sitting reaches 100: pair the connector, answer the ten
 *  core questions (~15 min), let the patterns land, take five blind tests.
 *  Depth is worth a little — it is an invitation, never a debt. */
export const PART_MAX = { connector: 20, started: 10, core: 40, patterns: 10, scored: 15, depth: 5 } as const;
export const CORE_TOTAL = 10;
export const DEPTH_FULL_AT = 10;

export function progressParts(d: { connector: boolean; answered: number; coreDone: number; patterns: number; scored: number }): ProgressParts {
  const coreDone = Math.max(0, Math.min(CORE_TOTAL, d.coreDone));
  const extra = Math.max(0, d.answered - coreDone);
  const parts = {
    connector: d.connector ? PART_MAX.connector : 0,
    started: d.answered > 0 ? PART_MAX.started : 0,
    core: PART_MAX.core * (coreDone / CORE_TOTAL),
    patterns: PART_MAX.patterns * Math.min(d.patterns / 3, 1),
    scored: PART_MAX.scored * Math.min(d.scored / 5, 1),
    depth: PART_MAX.depth * Math.min(extra / DEPTH_FULL_AT, 1),
  };
  const pct = Math.min(100, Math.round(parts.connector + parts.started + parts.core + parts.patterns + parts.scored + parts.depth));
  return { ...parts, pct };
}
