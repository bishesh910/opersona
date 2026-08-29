import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { INTERVIEW_CATEGORIES } from '@opersona/shared';

/** One progress number, everywhere. The nav bar and the claude.ai interview
 *  greeting MUST show the same figure — two different "your opersona is at X%"
 *  claims read as a bug (and were one). */
export interface ProgressData {
  pct: number;
  connector: boolean;
  answered: number;
  coveragePct: number;   // 0..100, interview coverage average over ALL ten areas
  patterns: number;      // confirmed reasoning patterns
  scored: number;        // scored blind scenarios
  bridgePaired: boolean;
}

/** Build-progress heuristic. Honest about being a heuristic (the nav guide
 *  panel itemizes it): connector 20 · interview started 10 · interview
 *  coverage 45 · confirmed patterns 10 (full at 3) · scored blind scenarios
 *  15 (full at 5). Untouched interview categories count as zero coverage —
 *  the average is over ALL categories, not just visited ones. */
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
  const pct = Math.round(
    (connector ? 20 : 0) + (answered > 0 ? 10 : 0) + 45 * coverage
    + 10 * Math.min(patterns / 3, 1) + 15 * Math.min(scored / 5, 1),
  );
  return { pct: Math.min(100, pct), connector, answered, coveragePct: Math.round(coverage * 100), patterns, scored, bridgePaired: !!btok };
}
