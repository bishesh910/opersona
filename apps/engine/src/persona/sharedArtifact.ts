/**
 * The privacy-safe SHARED artifact (`opersona/persona@1`) — what publishing
 * snapshots and importing materializes. Built ONLY from confirmed + shareable
 * rows; never touches episodes, lessons, evidence quotes, autonomy, org data
 * or documents (the schema in @opersona/shared has no fields for them).
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, clones, personaBriefs, facts, playbooks, reasoningPatterns, personalityTests } from '@opersona/db';
import { PersonaArtifact, PERSONA_ARTIFACT_SPEC, ARTIFACT_CAPS } from '@opersona/shared';
import { renderPersona } from './assemble.js';
import { accuracy } from '../learning/selfTest.js';

export interface SharedExportOpts {
  author: { name: string; slug?: string | null; site: string };
  version: number;
  bio?: string | null;
  sections: { facts?: boolean; playbooks?: boolean; personality?: boolean };
}

export async function exportSharedPersona(orgId: string, cloneId: string, opts: SharedExportOpts): Promise<PersonaArtifact> {
  const [clone] = await db.select().from(clones).where(and(eq(clones.id, cloneId), eq(clones.orgId, orgId))).limit(1);
  if (!clone) throw new Error('clone not found');
  const [brief] = await db.select().from(personaBriefs).where(eq(personaBriefs.cloneId, cloneId)).limit(1);
  const name = brief?.displayName || clone.name;

  const patterns = (await db.select().from(reasoningPatterns)
    .where(and(eq(reasoningPatterns.cloneId, cloneId), eq(reasoningPatterns.status, 'confirmed'))))
    .sort((a, b) => b.strength - a.strength).slice(0, ARTIFACT_CAPS.patterns);
  const fs = opts.sections.facts === false ? [] : (await db.select().from(facts)
    .where(and(eq(facts.cloneId, cloneId), eq(facts.status, 'confirmed'), eq(facts.shareable, true)))).slice(0, ARTIFACT_CAPS.facts);
  const pbs = opts.sections.playbooks === false ? [] : (await db.select().from(playbooks)
    .where(and(eq(playbooks.cloneId, cloneId), eq(playbooks.status, 'confirmed'), eq(playbooks.shareable, true)))).slice(0, ARTIFACT_CAPS.playbooks);
  const [personality] = opts.sections.personality === false ? [] : await db.select().from(personalityTests)
    .where(eq(personalityTests.cloneId, cloneId)).orderBy(desc(personalityTests.createdAt)).limit(1);

  let { prompt } = await renderPersona(orgId, cloneId, undefined, 'shared');
  if (prompt.length > ARTIFACT_CAPS.promptChars) prompt = prompt.slice(0, ARTIFACT_CAPS.promptChars - 2) + ' …';

  let acc: number | null = null;
  try {
    const a = await accuracy(cloneId);
    acc = a.pct == null ? null : a.pct / 100;
  } catch { /* stats are optional */ }

  const artifact: PersonaArtifact = {
    spec: PERSONA_ARTIFACT_SPEC,
    version: opts.version,
    publishedAt: new Date().toISOString(),
    persona: {
      name,
      roleTitle: brief?.roleTitle ?? null,
      bio: opts.bio?.trim().slice(0, 500) || null,
      avatarRecipe: clone.avatarRecipe ?? null,
      // Stated types export the letters only — ±1 direction sentinels are not strengths.
      personality: personality ? { type: personality.type, scores: personality.source === 'stated' ? {} : personality.scores } : null,
    },
    author: { name: opts.author.name, slug: opts.author.slug ?? null, site: opts.author.site },
    stats: { patterns: patterns.length, facts: fs.length, playbooks: pbs.length, accuracy: acc },
    thinking: patterns.map((p) => ({ key: p.patternKey, dimension: p.dimension, description: p.description.slice(0, 600), strength: Math.max(0, Math.min(1, p.strength)) })),
    facts: fs.map((f) => ({ statement: f.statement.slice(0, 600), domain: f.domain })),
    playbooks: pbs.map((p) => ({
      name: p.name.slice(0, 200), domain: p.domain, trigger: p.trigger.slice(0, 500),
      preconditions: p.preconditions.slice(0, 20).map((x) => x.slice(0, 500)),
      steps: p.steps.slice(0, 40).map((s) => ({ n: s.n, action: s.action.slice(0, 1000), command: s.command?.slice(0, 1000), check: s.check?.slice(0, 1000), expected: s.expected?.slice(0, 1000), if_not: s.if_not?.slice(0, 1000) })),
      pitfalls: p.pitfalls.slice(0, 20).map((x) => x.slice(0, 500)),
    })),
    systemPrompt: prompt,
  };
  // Validate against our own schema — a leak-by-bug becomes a loud failure here.
  return PersonaArtifact.parse(artifact);
}
