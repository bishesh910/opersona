import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import type { OrgCtx } from '@/lib/session';

/** The signed-in user's own clone (created on first visit so /chat always works). */
export async function getOrCreateOwnClone(ctx: OrgCtx): Promise<{ id: string }> {
  const [clone] = await db.select({ id: schema.clones.id }).from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.ownerUserId, ctx.userId))).limit(1);
  if (clone) return clone;
  const name = ctx.user.name?.trim() || ctx.user.email.split('@')[0] || 'My persona';
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.clones).values({ orgId: ctx.orgId, ownerUserId: ctx.userId, name }).returning({ id: schema.clones.id });
    await tx.insert(schema.personaBriefs).values({ cloneId: row!.id, orgId: ctx.orgId, displayName: name });
    return row!;
  });
}

export interface SidebarConversation { id: string; title: string; mode: 'claude' | 'clone'; lastActivityAt: string }

export async function listOwnConversations(cloneId: string, limit = 200): Promise<SidebarConversation[]> {
  const rows = await db.select({ id: schema.conversations.id, title: schema.conversations.title, mode: schema.conversations.mode, lastActivityAt: schema.conversations.lastActivityAt })
    .from(schema.conversations).where(eq(schema.conversations.cloneId, cloneId)).orderBy(desc(schema.conversations.lastActivityAt)).limit(limit);
  return rows.map((r) => ({ ...r, lastActivityAt: r.lastActivityAt.toISOString() }));
}

export const DEFAULT_TITLE_RE = /^(Chat \d{4}-\d{2}-\d{2} \d{2}:\d{2}|Clone test \d|Persona test \d{4}-\d{2}-\d{2} \d{2}:\d{2}|Conversation .*|New conversation|New chat)$/;
