import { describe, expect, it } from 'vitest';
import { ScenarioJudge, Prediction, JUDGE_WEIGHTS, calibrationScore, overallScore, MIN_SAMPLE } from '../src/learning/scenarios.js';

const dim = (score: number) => ({ score, rationale: 'because' });

describe('ScenarioJudge schema', () => {
  it('accepts a valid verdict', () => {
    const v = ScenarioJudge.parse({
      decision_match: dim(1), reasoning_factor_match: dim(0.5), preference_match: dim(0.8),
      communication_match: dim(0.2), key_differences: ['tone'], summary: 'close call',
    });
    expect(v.decision_match.score).toBe(1);
  });
  it('rejects out-of-range scores, missing dimensions, and junk', () => {
    expect(() => ScenarioJudge.parse({ decision_match: dim(1.4), reasoning_factor_match: dim(0), preference_match: dim(0), communication_match: dim(0), key_differences: [], summary: 's' })).toThrow();
    expect(() => ScenarioJudge.parse({ decision_match: dim(1), key_differences: [], summary: 's' })).toThrow();
    expect(() => ScenarioJudge.parse('nope')).toThrow();
  });
  it('Prediction schema demands at least one factor and bounded confidence', () => {
    expect(() => Prediction.parse({ decision: 'does the thing', factors: [], communication: 'calmly', confidence: 0.5 })).toThrow();
    expect(() => Prediction.parse({ decision: 'does the thing', factors: ['family'], communication: 'calmly', confidence: 1.3 })).toThrow();
  });
});

describe('score math', () => {
  it('weights sum to 1 and overall matches the hand-computed blend', () => {
    const sum = Object.values(JUDGE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1);
    const s = { decision: 1, reasoning: 0.5, preference: 0.8, communication: 0.2, calibration: 0.9 };
    expect(overallScore(s)).toBeCloseTo(0.35 * 1 + 0.3 * 0.5 + 0.15 * 0.8 + 0.1 * 0.2 + 0.1 * 0.9);
  });
  it('calibration rewards honesty, not confidence', () => {
    expect(calibrationScore(0.9, 0.9)).toBeCloseTo(1);   // confident and right
    expect(calibrationScore(0.5, 0.5)).toBeCloseTo(1);   // unsure and half-right — honest
    expect(calibrationScore(0.95, 0.1)).toBeCloseTo(0.15); // swaggering and wrong
    expect(calibrationScore(0.2, 1)).toBeCloseTo(0.2);   // underclaiming costs too
  });
  it('the sample gate is a real constant', () => {
    expect(MIN_SAMPLE).toBeGreaterThanOrEqual(5);
  });
});
