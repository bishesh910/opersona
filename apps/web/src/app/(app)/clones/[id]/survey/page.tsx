import { notFound } from 'next/navigation';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { SelfTestPanel } from '@/components/thinking/SelfTestPanel';

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

  return (
    <SelfTestPanel
      cloneId={id}
      readOnly={!access.canWrite}
      accuracyPct={acc.pct}
      history={ratedTests.map((t) => t.verdict!).reverse()}
      unrated={unratedTests.map((t) => ({ id: t.id, domain: t.domain, question: t.question, answer: t.answer }))}
    />
  );
}
