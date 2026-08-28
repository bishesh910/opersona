import { notFound } from 'next/navigation';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { FactList } from '@/components/memory/FactList';
import { PlaybookList } from '@/components/memory/PlaybookList';
import { PromptPanel } from '@/components/memory/PromptPanel';
import { EpisodeList } from '@/components/memory/EpisodeList';
import { MemoryList, TraitList, RuleList } from '@/components/memory/KnowledgeLists';

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  // Chat + learning content is private to the persona's owner — admins see metadata only.
  if (!access.isOwner) notFound();
  const id = access.clone.id;
  const [facts, playbooks, episodes, lifeMemories, traitRows, ruleRows] = await Promise.all([
    db.select().from(schema.facts).where(eq(schema.facts.cloneId, id)).orderBy(desc(schema.facts.pinned), desc(schema.facts.updatedAt)).limit(500),
    db.select().from(schema.playbooks).where(eq(schema.playbooks.cloneId, id)).orderBy(desc(schema.playbooks.updatedAt)).limit(200),
    db.select().from(schema.episodes).where(eq(schema.episodes.cloneId, id)).orderBy(desc(schema.episodes.createdAt)).limit(30),
    db.select().from(schema.memories).where(and(eq(schema.memories.cloneId, id), notInArray(schema.memories.status, ['retired', 'disputed'])))
      .orderBy(desc(schema.memories.importance), desc(schema.memories.updatedAt)).limit(200),
    db.select().from(schema.traits).where(and(eq(schema.traits.cloneId, id), notInArray(schema.traits.status, ['retired', 'disputed'])))
      .orderBy(desc(schema.traits.confidence)).limit(300),
    db.select().from(schema.contextualRules).where(and(eq(schema.contextualRules.cloneId, id), notInArray(schema.contextualRules.status, ['retired', 'disputed'])))
      .orderBy(desc(schema.contextualRules.confidence)).limit(200),
  ]);
  const snapshots = await db.select({
    version: schema.personaSnapshots.version, createdAt: schema.personaSnapshots.createdAt,
    tokenEstimate: schema.personaSnapshots.tokenEstimate, layerVersions: schema.personaSnapshots.layerVersions,
  }).from(schema.personaSnapshots).where(eq(schema.personaSnapshots.cloneId, id))
    .orderBy(desc(schema.personaSnapshots.version)).limit(15);
  const ro = !access.canWrite;
  const hasKnowledge = lifeMemories.length + traitRows.length + ruleRows.length > 0;
  return (
    <div className="space-y-6">
      {/* Interview-learned knowledge: who you are, what you hold, and when it bends. */}
      <section className="space-y-5">
        <div>
          <h2 className="font-medium">What the interview has learned {hasKnowledge && <span className="muted text-sm">({lifeMemories.length + traitRows.length + ruleRows.length})</span>}</h2>
          <p className="muted mt-0.5 text-sm">Built from your own answers on the Interview tab. Every item opens to show the exact words behind it.</p>
        </div>
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Values &amp; leanings {traitRows.length > 0 && <span className="muted">({traitRows.length})</span>}</h3>
          <TraitList cloneId={id} readOnly={ro} rows={traitRows.map((t) => ({ id: t.id, kind: t.kind, label: t.label, statement: t.statement, tier: t.tier, confidence: t.confidence, status: t.status, reinforceCount: t.reinforceCount, evidence: t.evidence }))} />
        </div>
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Life memories {lifeMemories.length > 0 && <span className="muted">({lifeMemories.length})</span>}</h3>
          <MemoryList cloneId={id} readOnly={ro} rows={lifeMemories.map((m) => ({ id: m.id, summary: m.summary, fullContext: m.fullContext, importance: m.importance, peopleInvolved: m.peopleInvolved, dateOrPeriod: m.dateOrPeriod, status: m.status, evidence: m.evidence }))} />
        </div>
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Rules &amp; exceptions {ruleRows.length > 0 && <span className="muted">({ruleRows.length})</span>}</h3>
          <RuleList cloneId={id} readOnly={ro} rows={ruleRows.map((r) => ({ id: r.id, situation: r.situation, condition: r.condition, tendency: r.tendency, tier: r.tier, confidence: r.confidence, status: r.status, evidence: r.evidence }))} />
        </div>
      </section>

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

      {/* Version history — every model change is a numbered snapshot; the layer
          counts show WHAT moved between versions. */}
      <details>
        <summary className="cursor-pointer">
          <span className="muted text-sm font-medium">Version history ({snapshots.length ? `v${snapshots[0]!.version}` : 'none yet'})</span>
          <span className="muted block text-xs">Each learning event republishes the persona as a new version — what changed, when.</span>
        </summary>
        {snapshots.length > 0 && (
          <ul className="mt-3 space-y-1">
            {snapshots.map((s, i) => {
              const prev = snapshots[i + 1];
              const lv = (s.layerVersions ?? {}) as Record<string, number>;
              const plv = (prev?.layerVersions ?? {}) as Record<string, number>;
              const deltas = Object.keys(lv)
                .filter((k) => typeof lv[k] === 'number' && lv[k] !== (plv[k] ?? 0))
                .map((k) => `${k} ${(plv[k] ?? 0)}→${lv[k]}`);
              return (
                <li key={s.version} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                  <span className="w-10 shrink-0 font-mono text-xs">v{s.version}</span>
                  <span className="muted shrink-0 text-xs" suppressHydrationWarning>{s.createdAt.toLocaleString()}</span>
                  <span className="muted shrink-0 text-xs">~{s.tokenEstimate} tokens</span>
                  <span className="muted min-w-0 text-xs">{i === snapshots.length - 1 && snapshots.length >= 15 ? '…' : deltas.length ? deltas.join(' · ') : 'no layer-count change'}</span>
                </li>
              );
            })}
          </ul>
        )}
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
