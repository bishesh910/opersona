/**
 * Persona export — the owner's full private backup: brief, fingerprint (with
 * evidence), facts, playbooks, avatar recipe, rendered prompt. Owner-only
 * (the web proxy enforces it). The privacy-safe SHARED artifact for publishing
 * is a separate shape — see `sharedArtifact.ts` (`opersona/persona@1`).
 */
import { and, eq } from 'drizzle-orm';
import { db, clones, personaBriefs, facts, playbooks, reasoningPatterns } from '@opersona/db';
import { type PatternRow } from '../learning/fingerprint.js';
import { activePrompt } from './assemble.js';

export async function exportPersona(orgId: string, cloneId: string) {
  const [clone] = await db.select().from(clones).where(and(eq(clones.id, cloneId), eq(clones.orgId, orgId))).limit(1);
  if (!clone) throw new Error('clone not found');
  const [brief] = await db.select().from(personaBriefs).where(eq(personaBriefs.cloneId, cloneId)).limit(1);
  const patterns = (await db.select().from(reasoningPatterns).where(eq(reasoningPatterns.cloneId, cloneId))) as unknown as PatternRow[];
  const fs = await db.select().from(facts).where(and(eq(facts.cloneId, cloneId), eq(facts.status, 'confirmed')));
  const pbs = await db.select().from(playbooks).where(and(eq(playbooks.cloneId, cloneId), eq(playbooks.status, 'confirmed')));
  const { prompt } = await activePrompt(orgId, cloneId);
  const name = brief?.displayName || clone.name;
  return {
    spec: 'opersona/persona-full@1',
    exportedAt: new Date().toISOString(),
    name,
    brief: brief ? { roleTitle: brief.roleTitle, team: brief.team, briefMd: brief.briefMd, operatingRules: brief.operatingRules } : null,
    fingerprint: patterns.filter((p) => p.status !== 'rejected').sort((a, b) => b.strength - a.strength).map((p) => ({
      key: p.patternKey, dimension: p.dimension, description: p.description, status: p.status, strength: p.strength, seenIn: p.nSources, examples: p.examples,
    })),
    facts: fs.map((f) => ({ statement: f.statement, domain: f.domain, pinned: f.pinned })),
    playbooks: pbs.map((p) => ({ name: p.name, domain: p.domain, trigger: p.trigger, preconditions: p.preconditions, steps: p.steps, pitfalls: p.pitfalls })),
    avatarRecipe: clone.avatarRecipe ?? null,
    systemPrompt: prompt,
  };
}
