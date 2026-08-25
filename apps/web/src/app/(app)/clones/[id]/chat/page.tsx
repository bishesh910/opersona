import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { createConversationAction, deleteConversationAction } from '@/actions/conversations';

export default async function ChatListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id: rawId } = await params;
  const { error } = await searchParams;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  // Chat + learning content is private to the persona's owner — admins see metadata only.
  if (!access.isOwner) notFound();
  const id = access.clone.id;
  const allConvs = await db.select().from(schema.conversations).where(eq(schema.conversations.cloneId, id)).orderBy(desc(schema.conversations.lastActivityAt)).limit(200);
  // The owner's own conversations vs. colleagues asking their persona ("Ask their persona").
  const convs = access.isOwner ? allConvs.filter((c) => c.userId === ctx.userId) : allConvs;
  const visitorConvs = access.isOwner ? allConvs.filter((c) => c.userId !== ctx.userId) : [];
  const visitorIds = visitorConvs.map((c) => c.id);
  const askerIds = [...new Set(visitorConvs.map((c) => c.userId))];
  const askers = askerIds.length
    ? await db.select({ id: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email }).from(authSchema.user).where(inArray(authSchema.user.id, askerIds))
    : [];
  const askerOf = new Map(askers.map((a) => [a.id, a]));
  const turnCounts = visitorIds.length
    ? await db.select({ conversationId: schema.turns.conversationId, n: sql<number>`count(*)::int` })
        .from(schema.turns).where(and(inArray(schema.turns.conversationId, visitorIds), ne(schema.turns.role, 'system')))
        .groupBy(schema.turns.conversationId)
    : [];
  const countOf = new Map(turnCounts.map((r) => [r.conversationId, r.n]));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-medium">Conversations</h2>
        {access.canWrite && (
          <form action={createConversationAction} className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="cloneId" value={id} />
            <input name="title" className="input w-full sm:w-56" placeholder="Title (optional)" />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1 whitespace-nowrap sm:flex-none" name="mode" value="clone" title="Talk to your persona to see how well it has learned you.">Test my persona</button>
            </div>
          </form>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {convs.length === 0 ? (
        <div className="card muted text-sm">No conversations yet. Each one is a footprint: your persona learns how you think from the way you work through problems.</div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {convs.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <Link href={access.isOwner ? `/c/${c.slug}` : `/clones/${id}/chat/${c.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="truncate text-sm font-medium">{c.title} {c.mode === 'clone' && <span className="chip ml-1">persona test</span>}</div>
                <div className="muted text-xs" suppressHydrationWarning>{c.status} · {c.lastActivityAt.toLocaleString()}</div>
              </Link>
              {access.canWrite && (
                <form action={deleteConversationAction}>
                  <input type="hidden" name="cloneId" value={id} />
                  <input type="hidden" name="conversationId" value={c.id} />
                  <button className="btn-secondary btn-sm">Delete</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {access.isOwner && (
        <section className="space-y-2 pt-2" data-visitor-conversations>
          <h2 className="font-medium">Conversations with my persona</h2>
          <p className="muted text-xs">Colleagues asking your persona questions — it answers in your name from what you chose to share. Read-only for you; never learned from.</p>
          {visitorConvs.length === 0 ? (
            <div className="card muted text-sm">Nobody has asked your persona anything yet.</div>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {visitorConvs.map((c) => {
                const asker = askerOf.get(c.userId);
                const n = countOf.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <Link href={`/me/chat/${c.id}`} className="block px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <div className="truncate text-sm font-medium">{c.title}</div>
                      <div className="muted text-xs" suppressHydrationWarning>
                        {asker?.name ?? asker?.email ?? c.userId} · {n === 1 ? '1 message' : `${n} messages`} · {c.lastActivityAt.toLocaleString()}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
