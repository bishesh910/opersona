import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { isOrgAdmin, type OrgCtx } from './org';

export type Clone = typeof schema.clones.$inferSelect;

export interface CloneAccess {
  clone: Clone;
  /** Owner of the persona. */
  isOwner: boolean;
  /** Owner, or org owner/admin (admins are read-only for chat). */
  canRead: boolean;
  /** Only the owner may edit persona layers or chat. */
  canWrite: boolean;
}

/**
 * Ownership check shared by pages, actions and the engine proxy.
 * A user may only touch clones they own unless they are org owner/admin (read-only).
 */
/** `me` is an alias for the signed-in user's own persona (short URLs: /me/…). */
export async function getCloneAccess(ctx: OrgCtx, cloneId: string): Promise<CloneAccess | null> {
  const own = cloneId === 'me';
  if (!own && !/^[0-9a-f-]{36}$/i.test(cloneId)) return null;
  const [clone] = await db
    .select()
    .from(schema.clones)
    .where(own ? and(eq(schema.clones.ownerUserId, ctx.userId), eq(schema.clones.orgId, ctx.orgId)) : and(eq(schema.clones.id, cloneId), eq(schema.clones.orgId, ctx.orgId)))
    .limit(1);
  if (!clone) return null;
  const isOwner = clone.ownerUserId === ctx.userId;
  const canRead = isOwner || isOrgAdmin(ctx);
  if (!canRead) return null;
  return { clone, isOwner, canRead, canWrite: isOwner };
}

/**
 * Public persona profile: ANY member of the org may view a colleague's persona
 * identity — brief, personality, Pixie, documents, and the LIMITED thinking view
 * (confirmed pattern descriptions only; evidence quotes stay owner-private).
 * Editing remains owner-only. Content pages (chat/memory/survey/full thinking)
 * must NOT use this — they gate on isOwner.
 */
export async function getProfileAccess(ctx: OrgCtx, cloneId: string): Promise<CloneAccess | null> {
  const own = cloneId === 'me';
  if (!own && !/^[0-9a-f-]{36}$/i.test(cloneId)) return null;
  const [clone] = await db
    .select()
    .from(schema.clones)
    .where(own ? and(eq(schema.clones.ownerUserId, ctx.userId), eq(schema.clones.orgId, ctx.orgId)) : and(eq(schema.clones.id, cloneId), eq(schema.clones.orgId, ctx.orgId)))
    .limit(1);
  if (!clone) return null;
  const isOwner = clone.ownerUserId === ctx.userId;
  return { clone, isOwner, canRead: true, canWrite: isOwner };
}

export interface AskAccess {
  clone: Clone;
  /** True when the asker owns this persona (then /chat is the right surface, not /ask). */
  isOwner: boolean;
}

/**
 * "Ask their persona": ANY member of the same org may talk to a colleague's persona.
 * This grants access to the persona's chat surface only — never to its tabs
 * (brief/memory/…), and never to anyone else's conversations with it.
 */
export async function getAskAccess(ctx: OrgCtx, cloneId: string): Promise<AskAccess | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cloneId)) return null;
  const [clone] = await db
    .select()
    .from(schema.clones)
    .where(and(eq(schema.clones.id, cloneId), eq(schema.clones.orgId, ctx.orgId)))
    .limit(1);
  if (!clone) return null;
  return { clone, isOwner: clone.ownerUserId === ctx.userId };
}
