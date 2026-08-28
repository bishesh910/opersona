/**
 * Blind-enforcement contract for prediction scenarios. Writes ephemeral rows,
 * so it runs only against a scratch/test database (name ending _scratch/_test)
 * or with RUN_DB_TESTS=1 — never silently against production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../src/llm.js', () => ({ structuredCall: vi.fn(), textCall: vi.fn() }));
vi.mock('../src/keys.js', () => ({ orgModelConfig: vi.fn(async () => ({ apiKey: 'k', chatModel: 'c', extractModel: 'e', condenseModel: 'h' })) }));

import { structuredCall } from '../src/llm.js';
import { db, pool, predictionScenarios } from '@opersona/db';
import { inArray } from 'drizzle-orm';
import { openScenarios, answerScenario, skipScenario, similarity } from '../src/learning/scenarios.js';

const ORG = `tst_org_${randomUUID().slice(0, 8)}`;
const CLONE = randomUUID();
const ids: string[] = [];
let enabled = false;

const mkScenario = async (over: Partial<typeof predictionScenarios.$inferInsert> = {}) => {
  const [r] = await db.insert(predictionScenarios).values({
    orgId: ORG, cloneId: CLONE, batchId: randomUUID(), category: 'career', format: 'open', choices: [],
    scenario: 'You are offered a role that doubles your pay but moves you across the country on six weeks notice.',
    question: 'What do you do?',
    aiPrediction: { decision: 'Negotiates a delayed start, then takes it', factors: ['financial upside', 'family logistics'], communication: 'direct but warm', confidence: 0.7 },
    predictedAt: new Date(Date.now() - 3_600_000),
    ...over,
  }).returning();
  ids.push(r!.id);
  return r!;
};

beforeAll(async () => {
  const name = (await pool.query('select current_database() as d').catch(() => null))?.rows?.[0]?.d as string | undefined;
  enabled = process.env.RUN_DB_TESTS === '1' || /_scratch$|_test$/.test(name ?? '');
});

afterAll(async () => {
  if (enabled && ids.length) await db.delete(predictionScenarios).where(inArray(predictionScenarios.id, ids));
});

const judgeVerdict = {
  decision_match: { score: 0.8, rationale: 'same call' }, reasoning_factor_match: { score: 0.6, rationale: 'overlap' },
  preference_match: { score: 0.7, rationale: 'values align' }, communication_match: { score: 0.5, rationale: 'tone differs' },
  key_differences: ['pace'], summary: 'close',
};

describe('blind enforcement', () => {
  it('open payloads structurally lack the prediction and scores', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    await mkScenario();
    const open = await openScenarios(CLONE);
    expect(open.length).toBeGreaterThan(0);
    for (const row of open) {
      expect('aiPrediction' in row).toBe(false);
      expect('scoreOverall' in row).toBe(false);
      expect('humanAnswer' in row).toBe(false);
    }
  });

  it('answer is an atomic open→answered transition; the second submit gets 409', async () => {
    if (!enabled) return;
    vi.mocked(structuredCall).mockResolvedValue(judgeVerdict);
    const s = await mkScenario();
    const first = await answerScenario({ orgId: ORG, cloneId: CLONE, id: s.id, answer: 'I would take it, but only after my partner agrees.' });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.scenario.status).toBe('scored');
      expect(first.scenario.predictedAt!.getTime()).toBeLessThan(first.scenario.answeredAt!.getTime());
      expect(first.scenario.scoreOverall).toBeGreaterThan(0);
      expect(first.scenario.scoreCalibration).toBeCloseTo(1 - Math.abs(0.7 - 0.8));
    }
    const second = await answerScenario({ orgId: ORG, cloneId: CLONE, id: s.id, answer: 'changed my mind' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it('a judge crash leaves status=failed with the human answer intact', async () => {
    if (!enabled) return;
    vi.mocked(structuredCall).mockRejectedValueOnce(new Error('rail down'));
    const s = await mkScenario();
    const r = await answerScenario({ orgId: ORG, cloneId: CLONE, id: s.id, answer: 'I would decline — roots matter more.' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scenario.status).toBe('failed');
      expect(r.scenario.humanAnswer).toContain('roots matter');
      expect(r.scenario.scoreOverall).toBeNull();
    }
  });

  it('skip never judges and cross-org answers do not land', async () => {
    if (!enabled) return;
    const s = await mkScenario();
    expect(await skipScenario('some-other-org', CLONE, s.id)).toBe(false);
    expect(await skipScenario(ORG, CLONE, s.id)).toBe(true);
    const wrongOrg = await answerScenario({ orgId: 'some-other-org', cloneId: CLONE, id: (await mkScenario()).id, answer: 'x' });
    expect(wrongOrg.ok).toBe(false);
  });

  it('similarity gates the overall until MIN_SAMPLE scored rows exist', async () => {
    if (!enabled) return;
    vi.mocked(structuredCall).mockResolvedValue(judgeVerdict);
    // Already 1 scored from the atomic test; add until just under the gate, then cross it.
    let sim = await similarity(CLONE);
    while (sim.scored < 4) {
      const s = await mkScenario();
      await answerScenario({ orgId: ORG, cloneId: CLONE, id: s.id, answer: 'take it after negotiating' });
      sim = await similarity(CLONE);
    }
    expect(sim.overall).toBeNull();
    const s5 = await mkScenario();
    await answerScenario({ orgId: ORG, cloneId: CLONE, id: s5.id, answer: 'take it after negotiating' });
    sim = await similarity(CLONE);
    expect(sim.scored).toBeGreaterThanOrEqual(5);
    expect(sim.overall).not.toBeNull();
    expect(sim.perDimension.decision.avg).toBeCloseTo(0.8);
    expect(sim.note).toBe('internal-model-metric');
  });
});
