import Link from 'next/link';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg, isOrgAdmin } from '@/lib/session';
import { createMyCloneAction } from '@/actions/clones';
import { askPersonaAction } from '@/actions/conversations';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { InviteButton } from '@/components/clones/InviteButton';

export default async function ClonesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireOrg();
  const { error } = await searchParams;
  const admin = isOrgAdmin(ctx);
  // Everyone sees the org roster (to ask a colleague's persona); only owner/admin get the tab links.
  const all = await db.select().from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId)).orderBy(desc(schema.clones.createdAt));
  const mine = all.find((c) => c.ownerUserId === ctx.userId);
  const ownerIds = [...new Set(all.map((c) => c.ownerUserId))];
  const owners = ownerIds.length
    ? await db.select({ id: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email }).from(authSchema.user).where(inArray(authSchema.user.id, ownerIds))
    : [];
  const ownerOf = new Map(owners.map((o) => [o.id, o]));
  const allIds = all.map((c) => c.id);
  const patternRows = allIds.length
    ? await db
        .select({ cloneId: schema.reasoningPatterns.cloneId, n: sql<number>`count(*)::int` })
        .from(schema.reasoningPatterns)
        .where(and(inArray(schema.reasoningPatterns.cloneId, allIds), ne(schema.reasoningPatterns.status, 'rejected')))
        .groupBy(schema.reasoningPatterns.cloneId)
    : [];
  const patternsOf = new Map(patternRows.map((r) => [r.cloneId, r.n]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Personas</h1>
        <div className="flex items-center gap-2">
          {admin && <InviteButton />}
          {!mine && (
            <form action={createMyCloneAction}>
              <button className="btn-primary">Create my persona</button>
            </form>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {all.length === 0 ? (
        <div className="card muted text-sm">
          No clones yet. {mine ? '' : 'Create yours to get started — it learns your job from your brief, your playbooks and your conversations.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {all.map((c) => {
            const owner = ownerOf.get(c.ownerUserId);
            const isMine = c.ownerUserId === ctx.userId;
            const nPatterns = patternsOf.get(c.id) ?? 0;
            const body = (
              <div className="flex items-center gap-3">
                <AvatarThumb recipe={c.avatarRecipe} name={c.name} scale={2} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name}{isMine && <span className="chip ml-2">mine</span>}</div>
                  <div className="muted truncate text-xs">{owner?.name ?? owner?.email ?? c.ownerUserId}</div>
                  <div className="muted text-xs">{nPatterns === 1 ? '1 pattern learned' : `${nPatterns} patterns learned`}</div>
                </div>
              </div>
            );
            return (
              <li key={c.id} className="card space-y-3">
                {isMine || admin
                  ? <Link href={isMine ? '/me' : `/clones/${c.id}`} className="-m-1 block rounded p-1 hover:bg-neutral-50 dark:hover:bg-neutral-900">{body}</Link>
                  : body}
                {!isMine && (
                  <form action={askPersonaAction}>
                    <input type="hidden" name="cloneId" value={c.id} />
                    <button className="btn-secondary btn-sm w-full" data-ask-persona title={`Ask ${c.name}'s persona a question — it answers the way they would`}>Ask their persona</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
