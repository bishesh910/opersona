import { describe, it, expect } from 'vitest';
import { renderPersona, CORE_RULES } from '../src/persona/assemble.js';

// Integration: uses the local pilot DB and the smoke org seeded by scripts/seed-wazuh.mts.
const ORG = 'org_smoke';
describe('renderPersona', () => {
  it('is deterministic (same hash twice) and has CORE_RULES as a byte-identical prefix', async () => {
    const { db, clones } = await import('@opersona/db');
    const { eq } = await import('drizzle-orm');
    const [c] = await db.select().from(clones).where(eq(clones.orgId, ORG)).limit(1);
    if (!c) return; // not seeded in this environment
    const a = await renderPersona(ORG, c.id);
    const b = await renderPersona(ORG, c.id);
    expect(a.promptHash).toBe(b.promptHash);
    expect(a.prompt.startsWith(CORE_RULES)).toBe(true);
    expect(a.prompt).not.toMatch(/\b20\d\d-\d\d-\d\d\b/); // no dates above the cache line
    expect(a.prompt).toContain('## Playbooks (index');
  });
});
