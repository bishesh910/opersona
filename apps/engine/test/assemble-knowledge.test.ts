/**
 * Interview knowledge in the rendered persona: owner sees confirmed traits /
 * rules / memories; non-owner audiences see only shareable rows (default none);
 * hypothesis-tier is never rendered; renders are byte-deterministic.
 * Skips when the environment has no clone with interview knowledge.
 */
import { describe, expect, it } from 'vitest';

describe('renderPersona × interview knowledge', () => {
  it('renders confirmed knowledge for the owner, hides it from shared, deterministically', async () => {
    const { db, traits, clones } = await import('@opersona/db');
    const { and, eq, inArray } = await import('drizzle-orm');
    const { renderPersona } = await import('../src/persona/assemble.js');

    const seeded = await db.select({ cloneId: traits.cloneId, orgId: traits.orgId }).from(traits)
      .where(and(eq(traits.status, 'confirmed'), inArray(traits.tier, ['explicit', 'inferred']))).limit(1);
    if (!seeded[0]) return; // not seeded in this environment
    const { cloneId, orgId } = seeded[0];
    const [clone] = await db.select({ kind: clones.kind }).from(clones).where(eq(clones.id, cloneId)).limit(1);
    if (clone?.kind !== 'member') return;

    const a = await renderPersona(orgId, cloneId);
    const b = await renderPersona(orgId, cloneId);
    expect(a.promptHash).toBe(b.promptHash);
    expect(a.prompt).toContain('values and how they lean');
    expect(a.layerVersions.traits as number).toBeGreaterThan(0);

    // Hypothesis-tier never appears, whatever the status.
    const hyps = await db.select({ label: traits.label }).from(traits)
      .where(and(eq(traits.cloneId, cloneId), eq(traits.tier, 'hypothesis')));
    for (const h of hyps) expect(a.prompt).not.toContain(`${h.label}:`);

    // Shared audience: only shareable rows (default false ⇒ the section is absent
    // unless the owner opted rows in).
    const shared = await renderPersona(orgId, cloneId, undefined, 'shared');
    const shareableCount = (await db.select({ id: traits.id }).from(traits)
      .where(and(eq(traits.cloneId, cloneId), eq(traits.status, 'confirmed'), eq(traits.shareable, true)))).length;
    if (shareableCount === 0) expect(shared.prompt).not.toContain('values and how they lean');
  });

  it('recallMemory serves the knowledge layers to the owner and none to visitors', async () => {
    const { db, traits } = await import('@opersona/db');
    const { and, eq } = await import('drizzle-orm');
    const { recallMemory } = await import('../src/persona/retrieval.js');

    const seeded = await db.select({ cloneId: traits.cloneId, label: traits.label }).from(traits)
      .where(and(eq(traits.status, 'confirmed'))).limit(1);
    if (!seeded[0]) return; // not seeded in this environment
    const { cloneId, label } = seeded[0];

    const hits = await recallMemory(cloneId, label, undefined, 10, false);
    expect(hits.some((h) => h.layer === 'traits' || h.layer === 'memories' || h.layer === 'rules')).toBe(true);

    const visitorHits = await recallMemory(cloneId, label, undefined, 10, true);
    expect(visitorHits.every((h) => h.layer === 'facts' || h.layer === 'playbooks')).toBe(true);
  });
});
