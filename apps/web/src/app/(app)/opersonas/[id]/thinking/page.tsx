import { notFound } from 'next/navigation';
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getProfileAccess } from '@/lib/clones';
import { listImportJobs } from '@/lib/imports';
import { engineFetch } from '@/lib/engine';
import { PatternsPanel, type PatternRow } from '@/components/thinking/PatternsPanel';
import { DimensionDonut, type DonutSlice } from '@/components/thinking/DimensionDonut';
import { ImportPanel } from '@/components/thinking/ImportPanel';
import { ClaudeCodePanel } from '@/components/thinking/ClaudeCodePanel';
import { StatStrip } from '@/components/thinking/StatStrip';

export const dynamic = 'force-dynamic';

export default async function ThinkingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getProfileAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;

  // Colleagues get the LIMITED view: confirmed pattern descriptions grouped by
  // dimension + the accuracy stat. No evidence quotes, no counts, no sources,
  // no import tooling — those are the owner's alone.
  if (!access.isOwner) {
    const confirmed = await db
      .select({ dimension: schema.reasoningPatterns.dimension, description: schema.reasoningPatterns.description })
      .from(schema.reasoningPatterns)
      .where(and(eq(schema.reasoningPatterns.cloneId, id), eq(schema.reasoningPatterns.status, 'confirmed')))
      .orderBy(desc(schema.reasoningPatterns.strength));
    const publicAcc = await engineFetch<{ me: number; notMe: number; pct: number | null }>(`/clones/${id}/accuracy`, { query: { orgId: ctx.orgId } })
      .catch(() => ({ me: 0, notMe: 0, pct: null as number | null }));
    const byDim = new Map<string, string[]>();
    for (const p of confirmed) { const arr = byDim.get(p.dimension) ?? []; arr.push(p.description); byDim.set(p.dimension, arr); }
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="font-medium">How {access.clone.name} thinks</h2>
          <p className="muted mt-1 text-sm">
            Confirmed reasoning patterns this persona applies — the distilled descriptions only.
            The conversations and quotes they were learned from are private to {access.clone.name}.
          </p>
        </div>
        {publicAcc.pct != null && (
          <p className="muted text-sm">Sounds-like-them accuracy: <span className="font-medium text-neutral-800 dark:text-neutral-200">{publicAcc.pct}%</span> (rated by {access.clone.name})</p>
        )}
        {byDim.size === 0 && <p className="muted text-sm">Nothing confirmed yet — this persona is still learning.</p>}
        {[...byDim.entries()].map(([dim, descs]) => (
          <section key={dim} className="card space-y-1.5 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{dim.replace(/_/g, ' ')}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {descs.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  const [patterns, sources, feedback, jobs, ccSessions, ccTokens] = await Promise.all([
    db.select().from(schema.reasoningPatterns)
      .where(eq(schema.reasoningPatterns.cloneId, id))
      .orderBy(desc(schema.reasoningPatterns.strength), desc(schema.reasoningPatterns.lastSeenAt)),
    db.select({ kind: schema.reasoningObservations.sourceKind, n: sql<number>`count(distinct ${schema.reasoningObservations.sourceRef})::int` })
      .from(schema.reasoningObservations)
      .where(eq(schema.reasoningObservations.cloneId, id))
      .groupBy(schema.reasoningObservations.sourceKind),
    db.select({ verdict: schema.reasoningFeedback.verdict, n: sql<number>`count(*)::int` })
      .from(schema.reasoningFeedback)
      .where(and(eq(schema.reasoningFeedback.cloneId, id)))
      .groupBy(schema.reasoningFeedback.verdict),
    listImportJobs(id),
    db.select().from(schema.claudeCodeSessions)
      .where(eq(schema.claudeCodeSessions.cloneId, id))
      .orderBy(desc(schema.claudeCodeSessions.createdAt)).limit(20),
    access.canWrite
      ? db.select({ id: schema.ingestTokens.id, name: schema.ingestTokens.name, createdAt: schema.ingestTokens.createdAt, lastUsedAt: schema.ingestTokens.lastUsedAt })
        .from(schema.ingestTokens)
        .where(and(eq(schema.ingestTokens.cloneId, id), isNull(schema.ingestTokens.revokedAt)))
        .orderBy(desc(schema.ingestTokens.createdAt))
      : Promise.resolve([]),
  ]);
  const [{ n: claudeCode }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.claudeCodeSessions)
    .where(and(eq(schema.claudeCodeSessions.cloneId, id), eq(schema.claudeCodeSessions.status, 'done')));
  const [{ n: interviewAnswered }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.interviewAnswers)
    .where(and(eq(schema.interviewAnswers.cloneId, id), eq(schema.interviewAnswers.skipped, false)));

  // Overall accuracy (chat feedback + self-tests) from the engine; the page still renders if the engine is down.
  const acc = await engineFetch<{ me: number; notMe: number; pct: number | null }>(`/clones/${id}/accuracy`, { query: { orgId: ctx.orgId } })
    .catch(() => ({ me: 0, notMe: 0, pct: null as number | null }));
  const sim = await engineFetch<{ scored: number; overall: number | null }>(`/clones/${id}/similarity`, { query: { orgId: ctx.orgId } })
    .catch(() => null);

  // "This week" digest — plain SQL, no LLM.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [[{ n: newObs }], [{ n: newConfirmed }], [{ n: ccWeek }], [{ n: importWeek }], [{ n: convWeek }]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.reasoningObservations)
      .where(and(eq(schema.reasoningObservations.cloneId, id), gte(schema.reasoningObservations.createdAt, weekAgo))),
    // Approximation: any confirmed pattern touched in the last 7 days counts as "became confirmed this week"
    // (updatedAt moves on every recompute, so this can over-count — good enough for a digest line).
    db.select({ n: sql<number>`count(*)::int` }).from(schema.reasoningPatterns)
      .where(and(eq(schema.reasoningPatterns.cloneId, id), eq(schema.reasoningPatterns.status, 'confirmed'), gte(schema.reasoningPatterns.updatedAt, weekAgo))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.claudeCodeSessions)
      .where(and(eq(schema.claudeCodeSessions.cloneId, id), eq(schema.claudeCodeSessions.status, 'done'), gte(schema.claudeCodeSessions.createdAt, weekAgo))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.importJobs)
      .where(and(eq(schema.importJobs.cloneId, id), gte(schema.importJobs.createdAt, weekAgo))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.conversations)
      .where(and(eq(schema.conversations.cloneId, id), isNotNull(schema.conversations.extractedAt), gte(schema.conversations.extractedAt, weekAgo))),
  ]);
  const sessionsWeek = ccWeek + importWeek + convWeek;

  const rows: PatternRow[] = patterns.map((p) => ({
    key: p.patternKey, dimension: p.dimension, description: p.description, strength: p.strength, nSources: p.nSources,
    status: p.status, userVerdict: p.userVerdict ?? null, examples: p.examples ?? [], lastSeenAt: p.lastSeenAt.toISOString(),
  }));
  const chats = sources.find((s) => s.kind === 'conversation')?.n ?? 0;
  const imported = sources.find((s) => s.kind === 'import')?.n ?? 0;
  const me = feedback.find((f) => f.verdict === 'me')?.n ?? 0;
  const notMe = feedback.find((f) => f.verdict === 'not_me')?.n ?? 0;
  const ro = !access.canWrite;

  // Donut: confirmed patterns grouped by dimension, weighted by strength; top 5 + "Other".
  const DIM_LABEL: Record<string, string> = {
    decomposition: 'Breaking problems down', starting_point: 'Where I start', information: 'What I trust',
    verification: 'How I check', explanation: 'How I explain', risk: 'Risk', pace: 'Pace', other: 'Other',
  };
  const confirmedPatterns = patterns.filter((p) => p.status === 'confirmed');
  const byDim = new Map<string, { value: number; count: number }>();
  for (const p of confirmedPatterns) {
    const label = DIM_LABEL[p.dimension] ?? 'Other';
    const cur = byDim.get(label) ?? { value: 0, count: 0 };
    byDim.set(label, { value: cur.value + p.strength, count: cur.count + 1 });
  }
  const ranked = [...byDim.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.value - a.value);
  const donutSlices: DonutSlice[] = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  if (rest.length > 0) {
    const folded = rest.reduce((acc, d) => ({ value: acc.value + d.value, count: acc.count + d.count }), { value: 0, count: 0 });
    const other = donutSlices.find((d) => d.label === 'Other');
    if (other) { other.value += folded.value; other.count += folded.count; }
    else donutSlices.push({ label: 'Other', ...folded });
    donutSlices.sort((a, b) => b.value - a.value);
  }

  return (
    <div className="space-y-8">
      <StatStrip
        confirmed={rows.filter((p) => p.status === 'confirmed').length}
        emerging={rows.filter((p) => p.status === 'emerging').length}
        chats={chats}
        imported={imported}
        claudeCode={claudeCode}
        accuracy={me + notMe > 0 ? me / (me + notMe) : null}
        feedbackCount={me + notMe}
        accuracyPct={acc.pct}
        interviewAnswers={access.isOwner ? interviewAnswered : undefined}
        similarityPct={sim && sim.scored > 0 ? (sim.overall == null ? null : Math.round(sim.overall * 100)) : undefined}
      />
      <p className="muted text-xs">
        This week: learned from {sessionsWeek} {sessionsWeek === 1 ? 'session' : 'sessions'} · {newObs} new {newObs === 1 ? 'observation' : 'observations'} · {newConfirmed} {newConfirmed === 1 ? 'pattern' : 'patterns'} confirmed.
      </p>
      {donutSlices.length > 0 && <DimensionDonut slices={donutSlices} totalPatterns={confirmedPatterns.length} />}
      <PatternsPanel cloneId={id} patterns={rows} readOnly={ro} />
      <details id="sources" className="group scroll-mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <span className="muted flex items-center gap-2 text-sm font-medium">
            <span aria-hidden className="inline-block w-3 text-[10px] leading-none transition-transform group-open:rotate-90">▶</span>
            Add learning sources
          </span>
          <span className="muted block pl-5 text-xs">Claude Code hook · session upload · claude.ai export</span>
        </summary>
        <div className="mt-6 space-y-8">
          <ClaudeCodePanel
            cloneId={id}
            readOnly={ro}
            initialTokens={ccTokens.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null }))}
            initialSessions={ccSessions.map((s) => ({
              sessionId: s.sessionId, source: s.source, project: s.project, humanTurns: s.humanTurns, observations: s.observations,
              status: s.status, note: s.note, createdAt: s.createdAt.toISOString(),
            }))}
          />
          <ImportPanel cloneId={id} initialJobs={jobs} readOnly={ro} />
        </div>
      </details>
    </div>
  );
}
