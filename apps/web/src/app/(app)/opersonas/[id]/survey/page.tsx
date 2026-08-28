import { notFound } from 'next/navigation';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { SelfTestPanel } from '@/components/thinking/SelfTestPanel';
import { ScenarioTestPanel } from '@/components/thinking/ScenarioTestPanel';
import { SimilarityCard, type SimilarityData } from '@/components/thinking/SimilarityCard';

export const dynamic = 'force-dynamic';

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  // Chat + learning content is private to the persona's owner — admins see metadata only.
  if (!access.isOwner) notFound();
  const id = access.clone.id;

  // Self-tests: everything not yet rated, plus the last 10 verdicts for the history dots.
  const [unratedTests, ratedTests] = await Promise.all([
    db.select().from(schema.selfTests)
      .where(and(eq(schema.selfTests.cloneId, id), isNull(schema.selfTests.verdict)))
      .orderBy(schema.selfTests.createdAt),
    db.select({ verdict: schema.selfTests.verdict, ratedAt: schema.selfTests.ratedAt }).from(schema.selfTests)
      .where(and(eq(schema.selfTests.cloneId, id), isNotNull(schema.selfTests.verdict)))
      .orderBy(desc(schema.selfTests.ratedAt)).limit(10),
  ]);

  // Overall accuracy (chat feedback + self-tests) from the engine; the page still renders if the engine is down.
  const acc = await engineFetch<{ me: number; notMe: number; pct: number | null }>(`/clones/${id}/accuracy`, { query: { orgId: ctx.orgId } })
    .catch(() => ({ me: 0, notMe: 0, pct: null as number | null }));

  // Blind scenarios: the OPEN query selects ONLY blind-safe columns — the sealed
  // prediction never enters this page's payload (same discipline as the engine).
  const openScenarios = await db.select({
    id: schema.predictionScenarios.id, category: schema.predictionScenarios.category,
    format: schema.predictionScenarios.format, choices: schema.predictionScenarios.choices,
    scenario: schema.predictionScenarios.scenario, question: schema.predictionScenarios.question,
  }).from(schema.predictionScenarios)
    .where(and(eq(schema.predictionScenarios.cloneId, id), eq(schema.predictionScenarios.status, 'open')))
    .orderBy(schema.predictionScenarios.createdAt);
  const sim = await engineFetch<SimilarityData>(`/clones/${id}/similarity`, { query: { orgId: ctx.orgId } })
    .catch(() => null);

  return (
    <div className="space-y-8">
      <ScenarioTestPanel cloneId={id} readOnly={!access.canWrite} open={openScenarios} />
      {sim && <SimilarityCard data={sim} />}
      <div className="border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <SelfTestPanel
          cloneId={id}
          readOnly={!access.canWrite}
          accuracyPct={acc.pct}
          history={ratedTests.map((t) => t.verdict!).reverse()}
          unrated={unratedTests.map((t) => ({ id: t.id, domain: t.domain, question: t.question, answer: t.answer }))}
        />
      </div>
    </div>
  );
}
