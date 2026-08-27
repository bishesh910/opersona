import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getSessionCtx } from '@/lib/session';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';

export const metadata = {
  title: 'Explore personas — opersona',
  description: 'Borrow how other people think: published personas you can add to your own workspace.',
};
export const dynamic = 'force-dynamic';

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const { q = '', sort = 'popular' } = await searchParams;
  const session = await getSessionCtx();
  const rows = await db.select().from(schema.publishedPersonas)
    .where(and(eq(schema.publishedPersonas.visibility, 'public'), eq(schema.publishedPersonas.status, 'active')))
    .orderBy(sort === 'new' ? desc(schema.publishedPersonas.updatedAt) : desc(schema.publishedPersonas.importCount))
    .limit(200);
  const needle = q.trim().toLowerCase();
  const list = (needle
    ? rows.filter((r) => [r.artifact.persona.name, r.artifact.persona.roleTitle ?? '', r.artifact.persona.bio ?? '', r.artifact.author.name]
        .some((s) => s.toLowerCase().includes(needle)))
    : rows).slice(0, 60);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-10">
      <header className="space-y-2">
        <p className="muted text-xs uppercase tracking-widest"><Link href="/" className="hover:underline">opersona.me</Link></p>
        <h1 className="text-2xl font-semibold tracking-tight">Explore personas</h1>
        <p className="muted text-sm">
          People publish how they think — their reasoning patterns, facts and playbooks — as personas you can add
          to your own workspace. The copy runs on <em>your</em> Claude and never phones home.
        </p>
        {!session && (
          <p className="text-sm">
            <Link href="/sign-up" className="underline">Create your account</Link> to build your own persona and add others&apos;.
          </p>
        )}
      </header>

      <form className="flex gap-2" action="/explore" method="get">
        <input className="input flex-1" type="search" name="q" defaultValue={q} placeholder="search by name, role, topic…" aria-label="Search personas" />
        {sort !== 'popular' && <input type="hidden" name="sort" value={sort} />}
        <button className="btn-secondary" type="submit">Search</button>
      </form>
      <div className="muted flex gap-3 text-xs">
        <Link href={`/explore${needle ? `?q=${encodeURIComponent(q)}` : ''}`} className={sort === 'popular' ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'hover:underline'}>most added</Link>
        <Link href={`/explore?sort=new${needle ? `&q=${encodeURIComponent(q)}` : ''}`} className={sort === 'new' ? 'font-semibold text-neutral-900 dark:text-neutral-100' : 'hover:underline'}>newest</Link>
      </div>

      {list.length === 0 ? (
        <div className="card muted p-5 text-sm">
          {needle ? 'Nothing matches that search.' : 'No public personas yet — be the first: build yours and hit Share.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((r) => (
            <li key={r.id}>
              <Link href={`/p/${r.slug}`} className="card block space-y-2 p-4 transition-colors hover:border-neutral-400 dark:hover:border-neutral-600">
                <div className="flex items-center gap-3">
                  <AvatarThumb recipe={r.artifact.persona.avatarRecipe ?? null} name={r.artifact.persona.name} scale={2} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.artifact.persona.name}</div>
                    {r.artifact.persona.roleTitle && <div className="muted truncate text-xs">{r.artifact.persona.roleTitle}</div>}
                  </div>
                </div>
                {r.artifact.persona.bio && <p className="muted line-clamp-2 text-xs">{r.artifact.persona.bio}</p>}
                <p className="muted text-[11px]">
                  {r.artifact.stats.patterns} patterns · {r.artifact.stats.playbooks} playbooks
                  {r.importCount > 0 && <> · added {r.importCount}×</>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <footer className="muted border-t border-neutral-200 pt-4 text-xs dark:border-neutral-800">
        Every persona here was published deliberately by its author, who can unpublish at any time.{' '}
        <Link href="/privacy" className="underline">Privacy, honestly</Link>
      </footer>
    </div>
  );
}
