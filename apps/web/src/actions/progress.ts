'use server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';

/** Live count of interview answers still waiting for extraction — the nav
 *  panel polls this while a backlog drains so the number counts down in place. */
export async function failedExtractionCount(): Promise<number> {
  const ctx = await requireOrg();
  const [clone] = await db.select({ id: schema.clones.id }).from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.ownerUserId, ctx.userId), eq(schema.clones.kind, 'member'), isNull(schema.clones.archivedAt))).limit(1);
  if (!clone) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.interviewAnswers)
    .where(and(eq(schema.interviewAnswers.cloneId, clone.id), eq(schema.interviewAnswers.extractionStatus, 'failed'), eq(schema.interviewAnswers.skipped, false)));
  return row?.n ?? 0;
}
