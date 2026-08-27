'use server';
/**
 * Importing a persona = MATERIALIZING its `opersona/persona@1` artifact into
 * the importer's own workspace: a clone with kind='imported' plus real
 * facts/playbooks/patterns rows (sourceKind 'import'). By construction the
 * copy runs on the importer's rail/key, never the author's — and it never
 * learns (extraction no-ops for kind!=='member').
 *
 * The file roundtrip (download .persona.json anywhere, upload on any opersona
 * instance) is the federation story.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, type ReasoningDimension } from '@opersona/db';
import { parsePersonaArtifact, type PersonaArtifact } from '@opersona/shared';
import { requireOrg } from '@/lib/session';
import { getPublishedBySlug, canViewPublished } from '@/lib/community';
import type { OrgCtx } from '@/lib/session';

const DIMS = new Set(['decomposition', 'starting_point', 'information', 'verification', 'explanation', 'risk', 'pace', 'other']);
const dim = (d: string): ReasoningDimension => (DIMS.has(d) ? d as ReasoningDimension : 'other');

const IMPORT_CAP = 50; // personas per workspace — plenty, and a hard stop for abuse

async function materialize(ctx: OrgCtx, artifact: PersonaArtifact, source: { publishedId: string | null; slug: string | null }) {
  const nImports = await db.select({ c: sql<number>`count(*)::int` }).from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.kind, 'imported'), isNull(schema.clones.archivedAt)));
  if ((nImports[0]?.c ?? 0) >= IMPORT_CAP) throw new Error(`import limit reached (${IMPORT_CAP} personas)`);

  // name collision → suffix with the author
  const siblings = await db.select({ name: schema.clones.name }).from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), isNull(schema.clones.archivedAt)));
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  let name = artifact.persona.name;
  if (taken.has(name.toLowerCase())) name = `${artifact.persona.name} (${artifact.author.name})`.slice(0, 80);
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${artifact.persona.name} ${n++}`.slice(0, 80);

  return db.transaction(async (tx) => {
    const [clone] = await tx.insert(schema.clones).values({
      orgId: ctx.orgId, ownerUserId: ctx.userId, name,
      avatarRecipe: artifact.persona.avatarRecipe ?? null, kind: 'imported',
    }).returning();
    const cloneId = clone!.id;
    await tx.insert(schema.personaBriefs).values({
      cloneId, orgId: ctx.orgId, displayName: name,
      roleTitle: artifact.persona.roleTitle ?? '',
      briefMd: artifact.persona.bio ?? '',
    });
    const spine = {
      orgId: ctx.orgId, cloneId, status: 'confirmed' as const, confidence: 0.9,
      sourceKind: 'import' as const, sourceRef: source.slug, evidence: [], createdBy: ctx.userId,
    };
    for (const f of artifact.facts) {
      await tx.insert(schema.facts).values({ ...spine, statement: f.statement, domain: f.domain ?? null, tags: [], shareable: true });
    }
    for (const p of artifact.playbooks) {
      await tx.insert(schema.playbooks).values({
        ...spine, name: p.name, domain: p.domain ?? null, trigger: p.trigger,
        preconditions: p.preconditions, steps: p.steps, pitfalls: p.pitfalls, shareable: true,
      });
    }
    for (const t of artifact.thinking) {
      await tx.insert(schema.reasoningPatterns).values({
        cloneId, orgId: ctx.orgId, patternKey: t.key, dimension: dim(t.dimension),
        description: t.description, strength: t.strength ?? 0.7, nSources: 0,
        status: 'confirmed', examples: [],
      }).onConflictDoNothing();
    }
    if (artifact.persona.personality) {
      await tx.insert(schema.personalityTests).values({
        orgId: ctx.orgId, cloneId, answers: {},
        scores: artifact.persona.personality.scores as Record<'EI' | 'SN' | 'TF' | 'JP', number>,
        type: artifact.persona.personality.type,
      });
    }
    await tx.insert(schema.importedPersonas).values({
      orgId: ctx.orgId, cloneId, importedBy: ctx.userId,
      sourcePublishedId: source.publishedId, sourceSlug: source.slug,
      sourceVersion: artifact.version, artifact,
    });
    return cloneId;
  });
}

export async function importFromSlugAction(slug: string): Promise<{ cloneId: string }> {
  const ctx = await requireOrg();
  const pub = await getPublishedBySlug(slug);
  if (!pub || !(await canViewPublished(pub, { userId: ctx.userId, email: ctx.user.email }))) throw new Error('persona not found');
  const [dup] = await db.select({ cloneId: schema.importedPersonas.cloneId }).from(schema.importedPersonas)
    .innerJoin(schema.clones, eq(schema.clones.id, schema.importedPersonas.cloneId))
    .where(and(eq(schema.importedPersonas.orgId, ctx.orgId), eq(schema.importedPersonas.sourcePublishedId, pub.id), isNull(schema.clones.archivedAt))).limit(1);
  if (dup) throw new Error('already in your workspace — use "update" on it to pull the latest version');
  const cloneId = await materialize(ctx, pub.artifact, { publishedId: pub.id, slug: pub.slug });
  await db.update(schema.publishedPersonas).set({ importCount: sql`${schema.publishedPersonas.importCount} + 1` })
    .where(eq(schema.publishedPersonas.id, pub.id));
  revalidatePath('/opersonas');
  return { cloneId };
}

export async function importFromFileAction(raw: unknown): Promise<{ cloneId: string; error?: never } | { cloneId?: never; error: string }> {
  const ctx = await requireOrg();
  const parsed = parsePersonaArtifact(raw);
  if (!parsed.ok) return { error: parsed.error };
  const cloneId = await materialize(ctx, parsed.artifact, { publishedId: null, slug: parsed.artifact.author.slug ?? null });
  revalidatePath('/opersonas');
  return { cloneId };
}

/** Pull the latest published version: wipe the materialized layers and rebuild them. */
export async function updateImportAction(cloneId: string): Promise<{ version: number }> {
  const ctx = await requireOrg();
  const [prov] = await db.select().from(schema.importedPersonas)
    .where(and(eq(schema.importedPersonas.cloneId, cloneId), eq(schema.importedPersonas.orgId, ctx.orgId))).limit(1);
  if (!prov || prov.importedBy !== ctx.userId) throw new Error('not your import');
  if (!prov.sourceSlug) throw new Error('file imports have no source to update from');
  const pub = await getPublishedBySlug(prov.sourceSlug);
  if (!pub || !(await canViewPublished(pub, { userId: ctx.userId, email: ctx.user.email }))) throw new Error('the original persona is no longer available — your copy keeps working as-is');
  if (pub.version === prov.sourceVersion) return { version: pub.version };
  const a = pub.artifact;
  await db.transaction(async (tx) => {
    await tx.delete(schema.facts).where(eq(schema.facts.cloneId, cloneId));
    await tx.delete(schema.playbooks).where(eq(schema.playbooks.cloneId, cloneId));
    await tx.delete(schema.reasoningPatterns).where(eq(schema.reasoningPatterns.cloneId, cloneId));
    await tx.delete(schema.personalityTests).where(eq(schema.personalityTests.cloneId, cloneId));
    const spine = {
      orgId: ctx.orgId, cloneId, status: 'confirmed' as const, confidence: 0.9,
      sourceKind: 'import' as const, sourceRef: prov.sourceSlug, evidence: [], createdBy: ctx.userId,
    };
    for (const f of a.facts) await tx.insert(schema.facts).values({ ...spine, statement: f.statement, domain: f.domain ?? null, tags: [], shareable: true });
    for (const p of a.playbooks) await tx.insert(schema.playbooks).values({ ...spine, name: p.name, domain: p.domain ?? null, trigger: p.trigger, preconditions: p.preconditions, steps: p.steps, pitfalls: p.pitfalls, shareable: true });
    for (const t of a.thinking) await tx.insert(schema.reasoningPatterns).values({ cloneId, orgId: ctx.orgId, patternKey: t.key, dimension: dim(t.dimension), description: t.description, strength: t.strength ?? 0.7, nSources: 0, status: 'confirmed', examples: [] }).onConflictDoNothing();
    if (a.persona.personality) await tx.insert(schema.personalityTests).values({ orgId: ctx.orgId, cloneId, answers: {}, scores: a.persona.personality.scores as Record<'EI' | 'SN' | 'TF' | 'JP', number>, type: a.persona.personality.type });
    await tx.update(schema.personaBriefs).set({ roleTitle: a.persona.roleTitle ?? '', briefMd: a.persona.bio ?? '', updatedAt: new Date() }).where(eq(schema.personaBriefs.cloneId, cloneId));
    await tx.update(schema.clones).set({ avatarRecipe: a.persona.avatarRecipe ?? null, updatedAt: new Date() }).where(eq(schema.clones.id, cloneId));
    await tx.update(schema.importedPersonas).set({ sourceVersion: pub.version, artifact: a, updatedAt: new Date() }).where(eq(schema.importedPersonas.cloneId, cloneId));
  });
  revalidatePath(`/opersonas/${cloneId}`);
  return { version: pub.version };
}

/** Remove an imported persona from the workspace (archives it; conversations keep their history). */
export async function removeImportAction(cloneId: string): Promise<void> {
  const ctx = await requireOrg();
  const [clone] = await db.select().from(schema.clones)
    .where(and(eq(schema.clones.id, cloneId), eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.kind, 'imported'))).limit(1);
  if (!clone || clone.ownerUserId !== ctx.userId) throw new Error('not your import');
  await db.update(schema.clones).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(schema.clones.id, cloneId));
  revalidatePath('/opersonas');
}
