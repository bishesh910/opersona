import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getAskAccess } from '@/lib/clones';
import { askPersonaAction } from '@/actions/conversations';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';

/** My conversations with a colleague's persona. Never shows anyone else's. */
export default async function AskListPage({ params }: { params: Promise<{ cloneId: string }> }) {
  const { cloneId } = await params;
  const ctx = await requireOrg();
  const ask = await getAskAccess(ctx, cloneId);
  if (!ask) notFound();
  if (ask.isOwner) redirect('/me/chat');
  const { clone } = ask;
  const convs = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.cloneId, clone.id), eq(schema.conversations.orgId, ctx.orgId), eq(schema.conversations.userId, ctx.userId)))
    .orderBy(desc(schema.conversations.lastActivityAt)).limit(100);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/opersonas" className="muted text-xs hover:underline">← opersonas</Link>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AvatarThumb recipe={clone.avatarRecipe} name={clone.name} scale={2} />
          <div>
            <h1 className="text-xl font-semibold leading-tight">{clone.name}&rsquo;s persona</h1>
            <div className="muted text-xs">Your questions to it — only you see these conversations.</div>
          </div>
        </div>
        <form action={askPersonaAction}>
          <input type="hidden" name="cloneId" value={clone.id} />
          <button className="btn-primary" data-new-question>New question</button>
        </form>
      </div>
      {convs.length === 0 ? (
        <div className="card muted text-sm">No conversations yet. Ask how {clone.name} would approach something — the persona answers the way they would, from what they chose to share.</div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {convs.map((c) => (
            <li key={c.id}>
              <Link href={`/ask/${clone.id}/${c.slug}`} className="block px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <div className="truncate text-sm font-medium">{c.title}</div>
                <div className="muted text-xs" suppressHydrationWarning>{c.lastActivityAt.toLocaleString()}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
