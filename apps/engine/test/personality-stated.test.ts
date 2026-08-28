/**
 * Stated MBTI types (the owner typed their four letters in — no test taken):
 * the rendered prompt names the poles with "stated directly" and NEVER invents
 * per-axis percentages; ±1 direction sentinels must not read as "weak
 * preferences". Pure helpers are covered unconditionally; the render test
 * writes rows → runs only against a *_scratch/_test DB (or RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { statedScores, describeStatedMbti, MBTI_TYPES } from '@opersona/shared';
import { db, pool, clones, personalityTests } from '@opersona/db';

const ORG = `org_test_${randomUUID().slice(0, 8)}`;
const CLONE = randomUUID();
let enabled = false;

describe('stated MBTI helpers (pure)', () => {
  it('statedScores encodes direction only (±1) for every type', () => {
    for (const t of MBTI_TYPES) {
      const s = statedScores(t);
      expect(Object.values(s).every((v) => v === 1 || v === -1)).toBe(true);
      expect(s.EI < 0).toBe(t[0] === 'E');
      expect(s.SN < 0).toBe(t[1] === 'S');
      expect(s.TF < 0).toBe(t[2] === 'T');
      expect(s.JP < 0).toBe(t[3] === 'J');
    }
  });

  it('describeStatedMbti spells the poles, admits strengths are unmeasured, shows no numbers', () => {
    const d = describeStatedMbti('INTJ');
    expect(d).toContain('INTJ — Introversion, Intuition, Thinking, Judging');
    expect(d).toContain('not measured');
    expect(d).not.toMatch(/\d/);
  });
});

describe('renderPersona × stated personality', () => {
  beforeAll(async () => {
    const name = (await pool.query('select current_database() as d').catch(() => null))?.rows?.[0]?.d as string | undefined;
    enabled = process.env.RUN_DB_TESTS === '1' || /_scratch$|_test$/.test(name ?? '');
    if (!enabled) return;
    await db.insert(clones).values({ id: CLONE, orgId: ORG, ownerUserId: `u_${ORG}`, name: 'Typed Indira', kind: 'member' });
    await db.insert(personalityTests).values({ orgId: ORG, cloneId: CLONE, answers: {}, scores: statedScores('ENFP'), type: 'ENFP', source: 'stated' });
  });

  afterAll(async () => {
    if (!enabled) return;
    for (const t of ['personality_tests', 'persona_snapshots', 'clones'])
      await pool.query(`delete from ${t} where org_id = $1`, [ORG]);
  });

  it('renders the stated lens without invented percentages', async () => {
    if (!enabled) return;
    const { renderPersona } = await import('../src/persona/assemble.js');
    const r = await renderPersona(ORG, CLONE);
    expect(r.prompt).toContain('## Personality lens (self-reported, ENFP)');
    expect(r.prompt).toContain('stated directly');
    const lens = r.prompt.split('## Personality lens')[1]!.split('\n## ')[0]!;
    expect(lens).not.toMatch(/\d+%/);
    expect(lens).not.toContain('Weak preferences');
  });
});
