/**
 * The build meter's promise: one sitting reaches 100. Pure arithmetic, no DB.
 */
import { describe, expect, it } from 'vitest';
import { progressParts, PART_MAX } from '@/lib/persona-progress-math';

describe('progressParts', () => {
  it('the parts sum to exactly 100', () => {
    expect(Object.values(PART_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('one sitting reaches 100: connector + ten core answers + patterns + five blind tests + ten extra', () => {
    expect(progressParts({ connector: true, answered: 20, coreDone: 10, patterns: 3, scored: 5 }).pct).toBe(100);
  });
  it('the core interview alone (with the connector) is worth 70 — Ready is most of the journey', () => {
    expect(progressParts({ connector: true, answered: 10, coreDone: 10, patterns: 0, scored: 0 }).pct).toBe(70);
  });
  it('each core area is worth 4 points; depth beyond it is capped at 5', () => {
    const p = progressParts({ connector: false, answered: 4, coreDone: 4, patterns: 0, scored: 0 });
    expect(p.core).toBe(16);
    expect(p.depth).toBe(0);
    const deep = progressParts({ connector: false, answered: 60, coreDone: 10, patterns: 0, scored: 0 });
    expect(deep.depth).toBe(PART_MAX.depth);
  });
  it('a long interview that never touched every area is NOT rewarded like a finished core', () => {
    // 38 answers across 9 areas used to read as ~half done; now the missing area is the visible gap.
    const p = progressParts({ connector: true, answered: 38, coreDone: 9, patterns: 3, scored: 5 });
    expect(p.core).toBe(36);
    expect(p.pct).toBe(96);
  });
  it('never exceeds 100 and never goes negative', () => {
    expect(progressParts({ connector: true, answered: 999, coreDone: 99, patterns: 99, scored: 99 }).pct).toBe(100);
    expect(progressParts({ connector: false, answered: 0, coreDone: -3, patterns: 0, scored: 0 }).pct).toBe(0);
  });
});
