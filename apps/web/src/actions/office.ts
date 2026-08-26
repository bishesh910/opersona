'use server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getAskAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { DEFAULT_TITLE_RE } from '@/lib/chat';
import type { FeedbackVerdict, HistoryTurn } from '@/components/chat/ChatView';

export interface OfficeChatPayload {
  conversationId: string;
  slug: string;
  title: string;
  history: HistoryTurn[];
  feedback: Record<string, FeedbackVerdict>;
  isOwner: boolean;
  canResolveApprovals: boolean;
  cloneName: string;
  model: string | null;
  effort: string | null;
  showCost: boolean;
  userFirstName: string;
}

/**
 * Open the office side-chat with a persona: resume YOUR latest thread with it,
 * or start one. Same access rules as the ask flow — a member only ever sees
 * conversations they created; the persona's owner talks to their own persona
 * (the test surface). This is the munder-difflin "terminal in the sidebar",
 * opersona edition.
 */
export async function openOfficeChat(cloneId: string): Promise<OfficeChatPayload | { error: string }> {
  const ctx = await requireOrg();
  const ask = await getAskAccess(ctx, cloneId);
  if (!ask) return { error: 'Persona not found' };
  let [conv] = await db.select().from(schema.conversations)
    .where(and(
      eq(schema.conversations.orgId, ctx.orgId),
      eq(schema.conversations.cloneId, ask.clone.id),
      eq(schema.conversations.userId, ctx.userId),
      eq(schema.conversations.mode, 'clone'),
    ))
    .orderBy(desc(schema.conversations.createdAt)).limit(1);
  if (!conv) {
    const first = (ctx.user.name?.trim().split(/\s+/)[0]) || ctx.user.email.split('@')[0] || 'a colleague';
    [conv] = await db.insert(schema.conversations)
      .values({ orgId: ctx.orgId, cloneId: ask.clone.id, userId: ctx.userId, title: ask.isOwner ? 'Office chat' : `Asked by ${first}`, mode: 'clone' })
      .returning();
  }
  const turns = await db.select().from(schema.turns)
    .where(eq(schema.turns.conversationId, conv!.id)).orderBy(asc(schema.turns.createdAt));
  const history: HistoryTurn[] = turns.map((t) => ({ id: t.id, role: t.role, content: t.editedContent ?? t.content, toolUses: t.toolUses, files: t.files ?? undefined }));
  const feedback: Record<string, FeedbackVerdict> = {};
  if (ask.isOwner) {
    const fb = await db.select({ turnId: schema.reasoningFeedback.turnId, verdict: schema.reasoningFeedback.verdict })
      .from(schema.reasoningFeedback).where(eq(schema.reasoningFeedback.conversationId, conv!.id));
    for (const f of fb) feedback[f.turnId] = f.verdict;
  }
  const authMode = await engineFetch<{ mode: string }>('/auth/mode').then((j) => j.mode).catch(() => 'api-key');
  return {
    conversationId: conv!.id,
    slug: conv!.slug,
    title: DEFAULT_TITLE_RE.test(conv!.title) && history.length === 0 ? '' : conv!.title,
    history,
    feedback,
    isOwner: ask.isOwner,
    canResolveApprovals: ask.isOwner || ctx.role === 'owner',
    cloneName: ask.clone.name,
    model: conv!.model ?? null,
    effort: conv!.effort ?? null,
    showCost: authMode !== 'host-login',
    userFirstName: (ctx.user.name?.trim().split(/\s+/)[0]) || '',
  };
}

/** Star a persona as the office boss (org owner/admin only). Starring the current
 *  boss again removes the star. The boss runs the floor: delegates work and hires
 *  temporary specialist personas. */
export async function setBossAction(cloneId: string | null): Promise<void> {
  const ctx = await requireOrg();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw new Error('Only org admins can choose the boss');
  if (cloneId) {
    const ask = await getAskAccess(ctx, cloneId);
    if (!ask) throw new Error('Persona not found');
  }
  await db.insert(schema.orgSettings).values({ orgId: ctx.orgId, bossCloneId: cloneId })
    .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { bossCloneId: cloneId } });
  revalidatePath('/office');
}
