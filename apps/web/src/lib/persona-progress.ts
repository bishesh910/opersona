import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { INTERVIEW_CATEGORIES } from '@opersona/shared';
import { progressParts, type ProgressData } from '@/lib/persona-progress-math';

export type { ProgressData } from '@/lib/persona-progress-math';

/** One progress number, everywhere: the nav bar, its guide panel, and the
 *  claude.ai menu/interview greeting all show THIS figure, computed by the
 *  shared arithmetic in persona-progress-math.ts. Untouched interview
 *  categories count as zero coverage — the average is over ALL ten. */
export async function buildProgress(userId: string, orgId: string, cloneId: string | undefined): Promise<ProgressData> {
  const [consent] = await db.select({ id: authSchema.oauthConsent.id }).from(authSchema.oauthConsent)
    .where(eq(authSchema.oauthConsent.userId, userId)).limit(1);
  const connector = !!consent;
  if (!cloneId) return { pct: connector ? 20 : 0, connector, answered: 0, coveragePct: 0, patterns: 0, scored: 0, bridgePaired: false };
  const [[cov], [pat], [sc], [btok]] = await Promise.all([
    db.select({ sum: sql<number>`coalesce(sum(${schema.interviewCoverage.coverage}), 0)`, answered: sql<number>`coalesce(sum(${schema.interviewCoverage.answered}), 0)::int` })
      .from(schema.interviewCoverage).where(eq(schema.interviewCoverage.cloneId, cloneId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.reasoningPatterns)
      .where(and(eq(schema.reasoningPatterns.cloneId, cloneId), eq(schema.reasoningPatterns.status, 'confirmed'))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.predictionScenarios)
      .where(and(eq(schema.predictionScenarios.cloneId, cloneId), eq(schema.predictionScenarios.status, 'scored'))),
    db.select({ id: schema.bridgeTokens.id }).from(schema.bridgeTokens)
      .where(and(eq(schema.bridgeTokens.orgId, orgId), isNull(schema.bridgeTokens.revokedAt))).limit(1),
  ]);
  const coverage = Math.max(0, Math.min(1, (cov?.sum ?? 0) / INTERVIEW_CATEGORIES.length));
  const answered = cov?.answered ?? 0;
  const patterns = pat?.n ?? 0;
  const scored = sc?.n ?? 0;
  const coveragePct = Math.round(coverage * 100);
  const { pct } = progressParts({ connector, answered, coveragePct: coverage * 100, patterns, scored });
  return { pct, connector, answered, coveragePct, patterns, scored, bridgePaired: !!btok };
}
