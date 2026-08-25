'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getAskAccess, getCloneAccess } from '@/lib/clones';

export async function createConversationAction(form: FormData) {
  const cloneId = String(form.get('cloneId') ?? '');
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) redirect(`/clones/${cloneId}/chat?error=Only+the+owner+can+chat`);
  const title = String(form.get('title') ?? '').trim() || `Conversation ${new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`;
  const mode = String(form.get('mode') ?? '') === 'clone' ? 'clone' as const : 'claude' as const;
  const [row] = await db.insert(schema.conversations).values({ orgId: ctx.orgId, cloneId, userId: ctx.userId, title, mode }).returning({ id: schema.conversations.id, slug: schema.conversations.slug });
  redirect(access.isOwner ? `/c/${row!.slug}` : `/clones/${cloneId}/chat/${row!.id}`);
}

export async function deleteConversationAction(form: FormData) {
  const cloneId = String(form.get('cloneId') ?? '');
  const conversationId = String(form.get('conversationId') ?? '');
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) redirect(`/clones/${cloneId}/chat?error=Not+allowed`);
  await db.transaction(async (tx) => {
    await tx.delete(schema.turns).where(and(eq(schema.turns.conversationId, conversationId), eq(schema.turns.orgId, ctx.orgId)));
    await tx.delete(schema.conversations).where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.cloneId, cloneId), eq(schema.conversations.orgId, ctx.orgId)));
  });
  redirect(access.isOwner ? '/me/chat' : `/clones/${cloneId}/chat`);
}

/** Inline rename from the chat title. Owner only. Returns the saved title (or an error). */
export async function renameConversationAction(conversationId: string, title: string): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const ctx = await requireOrg();
  const [conv] = await db.select({ cloneId: schema.conversations.cloneId }).from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.orgId, ctx.orgId))).limit(1);
  if (!conv) return { ok: false, error: 'not found' };
  const access = await getCloneAccess(ctx, conv.cloneId);
  if (!access?.canWrite) return { ok: false, error: 'read-only' };
  const t = title.trim().slice(0, 120);
  if (!t) return { ok: false, error: 'empty title' };
  await db.update(schema.conversations).set({ title: t }).where(eq(schema.conversations.id, conversationId));
  return { ok: true, title: t };
}

/** Delete from the chat "…" menu; lands on /chat (which reopens the most recent remaining chat). */
export async function deleteChatAction(conversationId: string): Promise<void> {
  const ctx = await requireOrg();
  const [conv] = await db.select({ cloneId: schema.conversations.cloneId }).from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.orgId, ctx.orgId))).limit(1);
  if (conv) {
    const access = await getCloneAccess(ctx, conv.cloneId);
    if (access?.canWrite) {
      await db.transaction(async (tx) => {
        await tx.delete(schema.episodes).where(and(eq(schema.episodes.conversationId, conversationId), eq(schema.episodes.orgId, ctx.orgId)));
        await tx.delete(schema.turns).where(and(eq(schema.turns.conversationId, conversationId), eq(schema.turns.orgId, ctx.orgId)));
        await tx.delete(schema.conversations).where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.orgId, ctx.orgId)));
      });
    }
  }
  redirect('/chat');
}

/** "Ask their persona": any same-org member starts their own conversation with a colleague's persona. */
export async function askPersonaAction(form: FormData) {
  const cloneId = String(form.get('cloneId') ?? '');
  const ctx = await requireOrg();
  const ask = await getAskAccess(ctx, cloneId);
  if (!ask) redirect('/clones?error=Persona+not+found');
  if (ask.isOwner) redirect('/chat?mode=clone'); // your own persona → the owner test surface
  const first = (ctx.user.name?.trim().split(/\s+/)[0]) || ctx.user.email.split('@')[0] || 'a colleague';
  const [row] = await db.insert(schema.conversations)
    .values({ orgId: ctx.orgId, cloneId, userId: ctx.userId, title: `Asked by ${first}`, mode: 'clone' })
    .returning({ slug: schema.conversations.slug });
  redirect(`/ask/${cloneId}/${row!.slug}`);
}

/** Pin/unpin one of your own conversations (pinned sort first in the sidebar). */
export async function pinChatAction(conversationId: string, pinned: boolean): Promise<void> {
  const ctx = await requireOrg();
  await db.update(schema.conversations).set({ pinned })
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.userId, ctx.userId), eq(schema.conversations.orgId, ctx.orgId)));
  revalidatePath('/', 'layout');
}
