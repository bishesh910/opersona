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
  coveragePct: number;   // 0..100, interview coverage average over ALL ten areas
  patterns: number;      // confirmed reasoning patterns
  scored: number;        // scored blind scenarios
  bridgePaired: boolean;
}

export interface ProgressParts {
  connector: number;  // /20 — connector added on claude.ai
  started: number;    // /10 — interview started
  coverage: number;   // /45 — interview coverage of the ten areas
  patterns: number;   // /10 — confirmed thinking patterns (full credit at 3)
  scored: number;     // /15 — blind tests scored (full credit at 5)
  pct: number;        // rounded, capped total
}

export const PART_MAX = { connector: 20, started: 10, coverage: 45, patterns: 10, scored: 15 } as const;

export function progressParts(d: { connector: boolean; answered: number; coveragePct: number; patterns: number; scored: number }): ProgressParts {
  const parts = {
    connector: d.connector ? PART_MAX.connector : 0,
    started: d.answered > 0 ? PART_MAX.started : 0,
    coverage: PART_MAX.coverage * Math.max(0, Math.min(1, d.coveragePct / 100)),
    patterns: PART_MAX.patterns * Math.min(d.patterns / 3, 1),
    scored: PART_MAX.scored * Math.min(d.scored / 5, 1),
  };
  const pct = Math.min(100, Math.round(parts.connector + parts.started + parts.coverage + parts.patterns + parts.scored));
  return { ...parts, pct };
}
