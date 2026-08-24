import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, or } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getAskAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { DEFAULT_TITLE_RE } from '@/lib/chat';
import { ChatView, type HistoryTurn } from '@/components/chat/ChatView';

/** Full-height chat with a colleague's persona. Only the asker's OWN conversations resolve here. */
export default async function AskConversationPage({ params }: { params: Promise<{ cloneId: string; slug: string }> }) {
  const { cloneId, slug } = await params;
  const ctx = await requireOrg();
  const ask = await getAskAccess(ctx, cloneId);
  if (!ask) notFound();
  if (ask.isOwner) redirect('/me/chat');
  const [conv] = await db.select().from(schema.conversations)
    .where(and(/^[0-9a-f-]{36}$/i.test(slug) ? or(eq(schema.conversations.id, slug), eq(schema.conversations.slug, slug)) : eq(schema.conversations.slug, slug),
      eq(schema.conversations.cloneId, ask.clone.id), eq(schema.conversations.orgId, ctx.orgId),
      // Hard rule: a member only ever sees the conversations THEY created with this persona.
      eq(schema.conversations.userId, ctx.userId))).limit(1);
  if (!conv) notFound();
  const turns = await db.select().from(schema.turns).where(eq(schema.turns.conversationId, conv.id)).orderBy(asc(schema.turns.createdAt));
  const history: HistoryTurn[] = turns.map((t) => ({ id: t.id, role: t.role, content: t.editedContent ?? t.content, toolUses: t.toolUses }));
  const authMode = await engineFetch<{ mode: string }>('/auth/mode').then((j) => j.mode).catch(() => 'api-key');

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col md:h-[calc(100vh-3.25rem)]">
      <div className="flex items-center gap-2 px-1 pb-2">
        <Link href={`/ask/${ask.clone.id}`} className="muted text-xs hover:underline">← my questions to {ask.clone.name}</Link>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <ChatView
          key={conv.id}
          mode={conv.mode}
          visitorView
          newHref={`/ask/${ask.clone.id}`}
          cloneId={ask.clone.id}
          cloneName={ask.clone.name}
          avatar={ask.clone.avatarRecipe ?? null}
          conversationId={conv.id}
          title={DEFAULT_TITLE_RE.test(conv.title) && history.length === 0 ? '' : conv.title}
          model={null}
          effort={null}
          history={history}
          readOnly={false}
          canResolveApprovals={false}
          userFirstName={(ctx.user.name?.trim().split(/\s+/)[0]) || ''}
          showCost={authMode !== 'host-login'}
        />
      </div>
    </div>
  );
}
