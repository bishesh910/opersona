/**
 * Community layer helpers — publish/import/explore. Visibility is
 * owner-sovereign: 'public' is readable by anyone (logged out included),
 * 'restricted' only by the author and people they granted (email match).
 * Private = simply not published; the platform takes no editorial control
 * beyond report-driven delisting.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema, shortId } from '@opersona/db';

export const SITE_URL = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type Published = typeof schema.publishedPersonas.$inferSelect;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;
export const isSlug = (s: string) => SLUG_RE.test(s);

export function makeSlug(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'persona';
  return `${base}-${shortId(4)}`;
}

export async function getPublishedBySlug(slug: string): Promise<Published | null> {
  if (!isSlug(slug)) return null;
  const [row] = await db.select().from(schema.publishedPersonas).where(eq(schema.publishedPersonas.slug, slug)).limit(1);
  return row ?? null;
}

/** May this viewer see this published persona? (delisted/unpublished → nobody but staff tooling.) */
export async function canViewPublished(
  pub: Published,
  viewer: { userId: string; email: string } | null,
): Promise<boolean> {
  if (pub.status !== 'active') return false;
  if (pub.visibility === 'public') return true;
  if (!viewer) return false;
  if (pub.ownerUserId === viewer.userId) return true;
  const email = viewer.email.trim().toLowerCase();
  const [grant] = await db.select({ id: schema.personaGrants.id }).from(schema.personaGrants)
    .where(and(eq(schema.personaGrants.publishedId, pub.id), eq(schema.personaGrants.granteeEmail, email))).limit(1);
  if (grant) {
    // lazily bind the grant to the account that redeemed it (audit trail)
    await db.update(schema.personaGrants).set({ granteeUserId: viewer.userId })
      .where(and(eq(schema.personaGrants.id, grant.id), eq(schema.personaGrants.granteeEmail, email)));
    return true;
  }
  return false;
}
