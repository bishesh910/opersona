'use server';
/**
 * Publishing a persona — owner-sovereign sharing. The published row snapshots
 * a privacy-safe `opersona/persona@1` artifact built by the engine from
 * confirmed + shareable rows only. Republish bumps `version` and replaces the
 * snapshot; unpublish 404s the page (existing imports keep their copy — that
 * is stated in the publish UI).
 */
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { type PersonaArtifact } from '@opersona/shared';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { SITE_URL, makeSlug } from '@/lib/community';

export interface PublishState {
  published: null | {
    slug: string; visibility: 'public' | 'restricted'; status: string; version: number;
    importCount: number; publishedAt: string; updatedAt: string;
    sections: Record<string, boolean>; bio: string;
    grants: { id: string; email: string; redeemed: boolean }[];
  };
}

export interface PublishInput {
  bio: string;
  visibility: 'public' | 'restricted';
  sections: { facts: boolean; playbooks: boolean; personality: boolean };
}

async function ownedMemberClone(cloneId: string) {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.isOwner) throw new Error('only the persona owner can share it');
  if (access.clone.kind !== 'member') throw new Error('only your own learned persona can be published — not hired or imported copies');
  return { ctx, clone: access.clone };
}

export async function publishState(cloneId: string): Promise<PublishState> {
  const { clone } = await ownedMemberClone(cloneId);
  const [pub] = await db.select().from(schema.publishedPersonas).where(eq(schema.publishedPersonas.cloneId, clone.id)).limit(1);
  if (!pub) return { published: null };
  const grants = await db.select().from(schema.personaGrants).where(eq(schema.personaGrants.publishedId, pub.id));
  return {
    published: {
      slug: pub.slug, visibility: pub.visibility, status: pub.status, version: pub.version,
      importCount: pub.importCount, publishedAt: pub.publishedAt.toISOString(), updatedAt: pub.updatedAt.toISOString(),
      sections: pub.sections, bio: pub.artifact.persona.bio ?? '',
      grants: grants.map((g) => ({ id: g.id, email: g.granteeEmail, redeemed: !!g.granteeUserId })),
    },
  };
}

/** Build the artifact and preview it before publishing — informed consent: exactly what will be visible. */
export async function previewArtifactAction(cloneId: string, input: PublishInput): Promise<PersonaArtifact> {
  const { ctx, clone } = await ownedMemberClone(cloneId);
  const [existing] = await db.select({ version: schema.publishedPersonas.version, slug: schema.publishedPersonas.slug })
    .from(schema.publishedPersonas).where(eq(schema.publishedPersonas.cloneId, clone.id)).limit(1);
  return engineFetch<PersonaArtifact>(`/clones/${clone.id}/export-shared`, {
    body: {
      orgId: ctx.orgId,
      version: (existing?.version ?? 0) + 1,
      bio: input.bio || null,
      author: { name: ctx.user.name, slug: existing?.slug ?? null, site: SITE_URL },
      sections: input.sections,
    },
  });
}

/** Publish (first time) or republish (version bump + fresh snapshot). */
export async function publishAction(cloneId: string, input: PublishInput): Promise<{ slug: string; version: number }> {
  const { ctx, clone } = await ownedMemberClone(cloneId);
  const [existing] = await db.select().from(schema.publishedPersonas).where(eq(schema.publishedPersonas.cloneId, clone.id)).limit(1);
  const slug = existing?.slug ?? makeSlug(clone.name);
  const version = (existing?.version ?? 0) + 1;
  const artifact = await engineFetch<PersonaArtifact>(`/clones/${clone.id}/export-shared`, {
    body: {
      orgId: ctx.orgId, version, bio: input.bio || null,
      author: { name: ctx.user.name, slug, site: SITE_URL },
      sections: input.sections,
    },
  });
  if (existing) {
    await db.update(schema.publishedPersonas).set({
      artifact, sections: input.sections, visibility: input.visibility,
      status: 'active', version, unpublishedAt: null, updatedAt: new Date(),
    }).where(eq(schema.publishedPersonas.id, existing.id));
  } else {
    await db.insert(schema.publishedPersonas).values({
      orgId: ctx.orgId, cloneId: clone.id, ownerUserId: ctx.userId, slug,
      artifact, sections: input.sections, visibility: input.visibility, version,
    });
  }
  revalidatePath(`/p/${slug}`);
  revalidatePath('/explore');
  return { slug, version };
}

export async function unpublishAction(cloneId: string): Promise<void> {
  const { clone } = await ownedMemberClone(cloneId);
  const [pub] = await db.select().from(schema.publishedPersonas).where(eq(schema.publishedPersonas.cloneId, clone.id)).limit(1);
  if (!pub) return;
  await db.update(schema.publishedPersonas).set({ status: 'unpublished', unpublishedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.publishedPersonas.id, pub.id));
  revalidatePath(`/p/${pub.slug}`);
  revalidatePath('/explore');
}

export async function setVisibilityAction(cloneId: string, visibility: 'public' | 'restricted'): Promise<void> {
  const { clone } = await ownedMemberClone(cloneId);
  await db.update(schema.publishedPersonas).set({ visibility, updatedAt: new Date() })
    .where(eq(schema.publishedPersonas.cloneId, clone.id));
  revalidatePath('/explore');
}

export async function addGrantAction(cloneId: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const { clone } = await ownedMemberClone(cloneId);
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) return { ok: false, error: 'that does not look like an email address' };
  const [pub] = await db.select({ id: schema.publishedPersonas.id }).from(schema.publishedPersonas).where(eq(schema.publishedPersonas.cloneId, clone.id)).limit(1);
  if (!pub) return { ok: false, error: 'publish first, then grant access' };
  const n = await db.select({ c: sql<number>`count(*)::int` }).from(schema.personaGrants).where(eq(schema.personaGrants.publishedId, pub.id));
  if ((n[0]?.c ?? 0) >= 200) return { ok: false, error: 'grant limit reached (200)' };
  await db.insert(schema.personaGrants).values({ publishedId: pub.id, granteeEmail: e }).onConflictDoNothing();
  return { ok: true };
}

export async function removeGrantAction(cloneId: string, grantId: string): Promise<void> {
  const { clone } = await ownedMemberClone(cloneId);
  const [pub] = await db.select({ id: schema.publishedPersonas.id }).from(schema.publishedPersonas).where(eq(schema.publishedPersonas.cloneId, clone.id)).limit(1);
  if (!pub) return;
  await db.delete(schema.personaGrants).where(and(eq(schema.personaGrants.id, grantId), eq(schema.personaGrants.publishedId, pub.id)));
}
