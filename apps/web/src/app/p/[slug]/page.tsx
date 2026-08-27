import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getSessionCtx } from '@/lib/session';
import { getPublishedBySlug, canViewPublished } from '@/lib/community';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { ImportButton } from '@/components/community/ImportButton';
import { ReportForm } from '@/components/community/ReportForm';

export const dynamic = 'force-dynamic';

const DIM_LABEL: Record<string, string> = {
  decomposition: 'Breaking problems down',
  starting_point: 'Where they start',
  information: 'What they ask for and trust',
  verification: 'How they check themselves',
  explanation: 'How they explain',
  risk: 'Risk and caution',
  pace: 'Pace',
  other: 'Other habits',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pub = await getPublishedBySlug(slug);
  if (!pub || pub.status !== 'active' || pub.visibility !== 'public') return { title: 'Persona — opersona' };
  return {
    title: `${pub.artifact.persona.name} — opersona`,
    description: pub.artifact.persona.bio ?? `A persona that thinks like ${pub.artifact.persona.name}. Add it to your own opersona workspace.`,
  };
}

export default async function PublicPersonaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pub = await getPublishedBySlug(slug);
  const session = await getSessionCtx();
  if (!pub || !(await canViewPublished(pub, session ? { userId: session.userId, email: session.user.email } : null))) notFound();
  const a = pub.artifact;
  const isAuthor = session?.userId === pub.ownerUserId;

  let importedCloneId: string | null = null;
  if (session && !isAuthor) {
    const [row] = await db.select({ cloneId: schema.importedPersonas.cloneId }).from(schema.importedPersonas)
      .innerJoin(schema.clones, eq(schema.clones.id, schema.importedPersonas.cloneId))
      .where(and(eq(schema.importedPersonas.sourcePublishedId, pub.id), eq(schema.importedPersonas.importedBy, session.userId), isNull(schema.clones.archivedAt)))
      .limit(1);
    importedCloneId = row?.cloneId ?? null;
  }

  const byDim = new Map<string, string[]>();
  for (const t of a.thinking) {
    const k = DIM_LABEL[t.dimension] ? t.dimension : 'other';
    byDim.set(k, [...(byDim.get(k) ?? []), t.description]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-10">
      <header className="space-y-4">
        <p className="muted text-xs uppercase tracking-widest">
          <Link href="/explore" className="hover:underline">opersona.me — explore</Link>
          {pub.visibility === 'restricted' && <span className="chip ml-2 normal-case tracking-normal">shared with you</span>}
        </p>
        <div className="flex items-start gap-4">
          <AvatarThumb recipe={a.persona.avatarRecipe ?? null} name={a.persona.name} scale={3} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{a.persona.name}</h1>
            {a.persona.roleTitle && <p className="muted text-sm">{a.persona.roleTitle}</p>}
            <p className="muted mt-1 text-xs">
              published by {a.author.name} · v{pub.version}
              {pub.importCount > 0 && <> · added by {pub.importCount} {pub.importCount === 1 ? 'person' : 'people'}</>}
              {typeof a.stats.accuracy === 'number' && <> · sounds-like-them score {Math.round(a.stats.accuracy * 100)}%</>}
            </p>
          </div>
        </div>
        {a.persona.bio && <p className="text-sm">{a.persona.bio}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {isAuthor ? (
            <Link href="/me/share" className="btn-secondary">This is yours — manage sharing</Link>
          ) : importedCloneId ? (
            <Link href={`/clones/${importedCloneId}/chat`} className="btn-primary">In your workspace — chat</Link>
          ) : session ? (
            <ImportButton slug={pub.slug} />
          ) : (
            <Link href={`/sign-up?next=${encodeURIComponent(`/p/${pub.slug}`)}`} className="btn-primary">Add to your workspace</Link>
          )}
          <a className="muted text-xs hover:underline" href={`/api/p/${pub.slug}/artifact`}>download .persona.json</a>
        </div>
        <p className="muted text-xs">
          An added copy thinks the way {a.persona.name} thinks — using only what they chose to share. It runs on
          <em> your</em> Claude, never theirs, and it never learns anything about them beyond this snapshot.
        </p>
      </header>

      <section className="card space-y-1 p-5">
        <h2 className="font-medium">What&apos;s inside</h2>
        <p className="muted text-sm">
          {a.stats.patterns} thinking {a.stats.patterns === 1 ? 'pattern' : 'patterns'} · {a.stats.facts} shared {a.stats.facts === 1 ? 'fact' : 'facts'} · {a.stats.playbooks} {a.stats.playbooks === 1 ? 'playbook' : 'playbooks'}
        </p>
      </section>

      {byDim.size > 0 && (
        <section className="card space-y-3 p-5">
          <h2 className="font-medium">How {a.persona.name} thinks</h2>
          {[...byDim.entries()].map(([dimKey, lines]) => (
            <div key={dimKey}>
              <h3 className="muted text-xs font-semibold uppercase tracking-wide">{DIM_LABEL[dimKey]}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          ))}
        </section>
      )}

      {a.playbooks.length > 0 && (
        <section className="card space-y-2 p-5">
          <h2 className="font-medium">Playbooks</h2>
          <ul className="space-y-1.5 text-sm">
            {a.playbooks.map((p, i) => (
              <li key={i}><span className="font-medium">{p.name}</span><span className="muted"> — when: {p.trigger}</span></li>
            ))}
          </ul>
        </section>
      )}

      {a.facts.length > 0 && (
        <section className="card space-y-2 p-5">
          <h2 className="font-medium">Shared facts</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {a.facts.slice(0, 30).map((f, i) => <li key={i}>{f.statement}{f.domain ? <span className="muted"> ({f.domain})</span> : null}</li>)}
          </ul>
          {a.facts.length > 30 && <p className="muted text-xs">+ {a.facts.length - 30} more in the download</p>}
        </section>
      )}

      <footer className="space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <ReportForm slug={pub.slug} />
        <p className="muted text-xs">
          Published personas contain only what their author explicitly chose to share — never private
          conversations, documents or memory. <Link href="/privacy" className="underline">Privacy, honestly</Link>
        </p>
      </footer>
    </div>
  );
}
