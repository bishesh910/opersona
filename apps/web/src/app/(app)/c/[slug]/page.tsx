import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq, or } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { DEFAULT_TITLE_RE } from '@/lib/chat';
import { ChatView, type FeedbackVerdict, type HistoryTurn } from '@/components/chat/ChatView';

/** Full-height conversation view (own persona): slim bar on top, the rest is chat. */
export default async function ConversationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, 'me');
  if (!access) notFound();
  const [conv] = await db.select().from(schema.conversations)
    .where(and(/^[0-9a-f-]{36}$/i.test(slug) ? or(eq(schema.conversations.id, slug), eq(schema.conversations.slug, slug)) : eq(schema.conversations.slug, slug),
      eq(schema.conversations.cloneId, access.clone.id), eq(schema.conversations.orgId, ctx.orgId))).limit(1);
  if (!conv) notFound();
  const turns = await db.select().from(schema.turns).where(eq(schema.turns.conversationId, conv.id)).orderBy(asc(schema.turns.createdAt));
  const history: HistoryTurn[] = turns.map((t) => ({ id: t.id, role: t.role, content: t.editedContent ?? t.content, toolUses: t.toolUses }));
  const fb = await db.select({ turnId: schema.reasoningFeedback.turnId, verdict: schema.reasoningFeedback.verdict })
    .from(schema.reasoningFeedback).where(eq(schema.reasoningFeedback.conversationId, conv.id));
  const feedback: Record<string, FeedbackVerdict> = {};
  for (const f of fb) feedback[f.turnId] = f.verdict;
  const authMode = await engineFetch<{ mode: string }>('/auth/mode').then((j) => j.mode).catch(() => 'api-key');

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col sm:h-[calc(100dvh-3.5rem)]">
      <div className="flex items-center gap-2 px-1 pb-2">
        <Link href="/me/chat" className="muted text-xs hover:underline">← chats</Link>
      </div>
      <div className="safe-b mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
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
          readOnly={!access.canWrite}
          canResolveApprovals={access.isOwner || ctx.role === 'owner'}
          feedback={feedback}
          userFirstName={(ctx.user.name?.trim().split(/\s+/)[0]) || ''}
          showCost={authMode !== 'host-login'}
        />
      </div>
    </div>
  );
}
