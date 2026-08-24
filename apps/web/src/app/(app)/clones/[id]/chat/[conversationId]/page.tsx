import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, or } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { DEFAULT_TITLE_RE } from '@/lib/chat';
import { ChatView, type FeedbackVerdict, type HistoryTurn } from '@/components/chat/ChatView';
import { engineFetch } from '@/lib/engine';

export default async function ConversationPage({ params }: { params: Promise<{ id: string; conversationId: string }> }) {
  const { id: rawId, conversationId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const [conv] = await db.select().from(schema.conversations)
    .where(and(/^[0-9a-f-]{36}$/i.test(conversationId) ? or(eq(schema.conversations.id, conversationId), eq(schema.conversations.slug, conversationId)) : eq(schema.conversations.slug, conversationId), eq(schema.conversations.cloneId, access.clone.id), eq(schema.conversations.orgId, ctx.orgId))).limit(1);
  if (!conv) notFound();
  const turns = await db.select().from(schema.turns).where(eq(schema.turns.conversationId, conv.id)).orderBy(asc(schema.turns.createdAt));
  const history: HistoryTurn[] = turns.map((t) => ({ id: t.id, role: t.role, content: t.editedContent ?? t.content, toolUses: t.toolUses }));
  const fb = await db.select({ turnId: schema.reasoningFeedback.turnId, verdict: schema.reasoningFeedback.verdict })
    .from(schema.reasoningFeedback).where(eq(schema.reasoningFeedback.conversationId, conv.id));
  const feedback: Record<string, FeedbackVerdict> = {};
  for (const f of fb) feedback[f.turnId] = f.verdict;
  // A colleague's conversation with this persona ("Ask their persona"): the owner reviews it read-only.
  const visitorConv = conv.userId !== ctx.userId;

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] flex-col gap-2">
      <Link href={access.isOwner ? '/me/chat' : `/clones/${id}/chat`} className="muted text-xs hover:underline">← all conversations</Link>
      <ChatView
        key={conv.id}
        mode={conv.mode}
        cloneId={access.clone.id}
        cloneName={access.clone.name}
        avatar={access.clone.avatarRecipe ?? null}
        conversationId={conv.id}
        title={DEFAULT_TITLE_RE.test(conv.title) && history.length === 0 ? '' : conv.title}
        model={conv.model}
        effort={conv.effort}
        history={history}
        visitorView={visitorConv}
        readOnly={!access.canWrite || visitorConv}
        canResolveApprovals={access.isOwner || ctx.role === 'owner'}
        feedback={feedback}
        userFirstName={(ctx.user.name?.trim().split(/\s+/)[0]) || ''}
      />
    </div>
  );
}
