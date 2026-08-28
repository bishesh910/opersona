import { describe, expect, it } from 'vitest';
import { enforceContract, Simulation, ABSTAIN_PREFIX, type SimulationT } from '../src/persona/simulate.js';

const base: SimulationT = {
  answer: 'Takes the job after talking it through with their partner.',
  factors: [{ factor: 'partner alignment', weight: 'major' }],
  confidence: 0.8,
  uncertainty: [],
  evidence_used: [],
  enough_information: true,
};

describe('simulation contract (code-enforced)', () => {
  it('filters evidence_used to the ids the server actually offered', () => {
    const out = enforceContract({ ...base, evidence_used: ['real-1', 'invented-2', 'real-3'] }, new Set(['real-1', 'real-3']), 'ask');
    expect(out.evidence_used).toEqual(['real-1', 'real-3']);
  });

  it('forces the standard abstention when the model says the evidence is thin', () => {
    const out = enforceContract({ ...base, enough_information: false }, new Set(), 'ask');
    expect(out.answer.startsWith(ABSTAIN_PREFIX)).toBe(true);
    expect(out.enough_information).toBe(false);
  });

  it('leaves an already-abstaining answer alone', () => {
    const out = enforceContract({ ...base, enough_information: false, answer: `${ABSTAIN_PREFIX} about their money habits.` }, new Set(), 'ask');
    expect(out.answer).toBe(`${ABSTAIN_PREFIX} about their money habits.`);
  });

  it('compare without per-option verdicts degrades honestly instead of pretending', () => {
    const out = enforceContract(base, new Set(), 'compare');
    expect(out.enough_information).toBe(false);
    expect(out.confidence).toBeLessThanOrEqual(0.4);
    expect(out.answer.startsWith(ABSTAIN_PREFIX)).toBe(true);
    expect(out.comparison).toBeUndefined();
  });

  it('compare WITH verdicts passes through intact', () => {
    const out = enforceContract({
      ...base,
      comparison: [{ option: 'A', verdict: 'safer, they lean here', lean: 0.7 }, { option: 'B', verdict: 'tempting but no', lean: 0.3 }],
    }, new Set(), 'compare');
    expect(out.comparison).toHaveLength(2);
    expect(out.enough_information).toBe(true);
  });

  it('the schema refuses factor-less or out-of-range output', () => {
    expect(() => Simulation.parse({ ...base, factors: [] })).toThrow();
    expect(() => Simulation.parse({ ...base, confidence: 1.2 })).toThrow();
    expect(() => Simulation.parse({ ...base, comparison: [{ option: 'A', verdict: 'v', lean: 2 }] })).toThrow();
  });
});
