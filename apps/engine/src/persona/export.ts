/**
 * Persona export — the portable artefact. Two shapes:
 *  - `the-office/persona@1`: everything (brief, fingerprint, facts, playbooks, avatar recipe, rendered prompt)
 *  - `the-office/agent@1`: an agent manifest for The Office (our multi-agent office), whose `goal`
 *    carries "how this person thinks" so the agent on the floor reasons like them.
 */
import { and, eq } from 'drizzle-orm';
import { db, clones, personaBriefs, facts, playbooks, reasoningPatterns } from '@opersona/db';
import { renderFingerprint, type PatternRow } from '../learning/fingerprint.js';
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
    spec: 'the-office/persona@1',
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

/** The Office `the-office/agent@1` manifest. */
export async function exportHireManifest(orgId: string, cloneId: string) {
  const p = await exportPersona(orgId, cloneId);
  const patterns = p.fingerprint.filter((x) => x.status === 'confirmed').map((x) => ({ ...x, patternKey: x.key, nSources: x.seenIn, userVerdict: null, firstSeenAt: new Date(), lastSeenAt: new Date() })) as unknown as PatternRow[];
  const think = renderFingerprint(p.name, patterns).replace(/^## .*\n/, '').trim();
  const sections = [
    `You are ${p.name}'s clone on this office floor: do the work the way ${p.name} would, and explain it the way ${p.name} would.`,
    p.brief?.briefMd?.trim() ? `About ${p.name}: ${p.brief.briefMd.trim()}` : '',
    think ? `HOW ${p.name.toUpperCase()} THINKS — apply to every task, in any domain; reproduce the method, never a past answer:\n${think}` : '',
    p.brief?.operatingRules?.trim() ? `Hard rules: ${p.brief.operatingRules.trim()}` : '',
    p.playbooks.length ? `Playbooks ${p.name} follows: ${p.playbooks.map((x) => `${x.name} (when: ${x.trigger})`).join('; ')}.` : '',
  ].filter(Boolean);
  let goal = sections.join('\n\n');
  if (goal.length > 4000) goal = goal.slice(0, 3990) + '…';
  const domains = [...new Set([...p.facts.map((f) => f.domain), ...p.playbooks.map((x) => x.domain)].filter((d): d is string => !!d))].slice(0, 12);
  return {
    spec: 'the-office/agent@1',
    name: p.name.slice(0, 40),
    description: (p.brief?.roleTitle || `${p.name}'s clone`).slice(0, 200),
    goal,
    provider: 'claude',
    capabilities: domains,
    isolate: true,
    author: 'the-office',
  };
}
