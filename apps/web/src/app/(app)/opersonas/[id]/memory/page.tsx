import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { FactList } from '@/components/memory/FactList';
import { PlaybookList } from '@/components/memory/PlaybookList';
import { PromptPanel } from '@/components/memory/PromptPanel';
import { EpisodeList } from '@/components/memory/EpisodeList';

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  // Chat + learning content is private to the persona's owner — admins see metadata only.
  if (!access.isOwner) notFound();
  const id = access.clone.id;
  const [facts, playbooks, episodes] = await Promise.all([
    db.select().from(schema.facts).where(eq(schema.facts.cloneId, id)).orderBy(desc(schema.facts.pinned), desc(schema.facts.updatedAt)).limit(500),
    db.select().from(schema.playbooks).where(eq(schema.playbooks.cloneId, id)).orderBy(desc(schema.playbooks.updatedAt)).limit(200),
    db.select().from(schema.episodes).where(eq(schema.episodes.cloneId, id)).orderBy(desc(schema.episodes.createdAt)).limit(30),
  ]);
  const ro = !access.canWrite;
  return (
    <div className="space-y-6">
      {/* Episodes — the living memory: one distilled entry per conversation, searchable by the persona via recall. */}
      <section>
        <h2 className="font-medium">Episodes ({episodes.length})</h2>
        <p className="muted mt-0.5 text-sm">One entry per finished conversation — what it was about, how it went. Your persona recalls these when asked about past work.</p>
        {episodes.length === 0 ? (
          <p className="muted mt-3 text-sm">No episodes yet — they appear automatically as you finish conversations.</p>
        ) : (
          <EpisodeList cloneId={id} readOnly={ro} episodes={episodes.map((e) => ({ id: e.id, title: e.title, problem: e.problem, outcome: e.outcome, date: e.createdAt.toLocaleDateString() }))} />
        )}
      </section>

      {/* Manual knowledge — optional, hand-taught; most personas never need it. */}
      <details className="group">
        <summary className="cursor-pointer">
          <span className="muted text-sm font-medium">Manual knowledge — facts &amp; playbooks ({facts.length + playbooks.length})</span>
          <span className="muted block text-xs">Optional hand-taught entries. The fingerprint on “How I think” learns automatically — this is for hard rules and procedures you want verbatim.</span>
        </summary>
        <div className="mt-4 space-y-8">
        <FactList
          cloneId={id}
          readOnly={ro}
          facts={facts.map((f) => ({ id: f.id, statement: f.statement, domain: f.domain, tags: f.tags, pinned: f.pinned, shareable: f.shareable, status: f.status, sourceKind: f.sourceKind, confidence: f.confidence }))}
        />
        <PlaybookList
          cloneId={id}
          readOnly={ro}
          playbooks={playbooks.map((p) => ({ id: p.id, name: p.name, domain: p.domain, trigger: p.trigger, preconditions: p.preconditions, steps: p.steps, pitfalls: p.pitfalls, shareable: p.shareable, status: p.status, version: p.version, sourceKind: p.sourceKind, outcomeStats: p.outcomeStats }))}
        />
        </div>
      </details>

      {/* Prompt inspector — the build artifact, for the curious. */}
      <details>
        <summary className="cursor-pointer">
          <span className="muted text-sm font-medium">Prompt inspector</span>
          <span className="muted block text-xs">The exact system prompt assembled from all layers — regenerated on every change, not accumulated.</span>
        </summary>
        <div className="mt-3 max-w-3xl"><PromptPanel cloneId={id} /></div>
      </details>
    </div>
  );
}
