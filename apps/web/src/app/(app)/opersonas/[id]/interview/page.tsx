import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { CATEGORY_LABEL, type InterviewCategory } from '@opersona/shared';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { InterviewRoom } from '@/components/interview/InterviewRoom';
import { AnswerHistory } from '@/components/interview/AnswerHistory';

export const dynamic = 'force-dynamic';

/** The cognitive interview — strictly the owner teaching their own persona. */
export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access?.isOwner || !access.canWrite) notFound();
  const answers = await db.select().from(schema.interviewAnswers)
    .where(eq(schema.interviewAnswers.cloneId, access.clone.id))
    .orderBy(desc(schema.interviewAnswers.createdAt)).limit(100);
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <InterviewRoom cloneId={access.clone.id} />
      <AnswerHistory
        cloneId={access.clone.id}
        rows={answers.map((a) => ({
          id: a.id,
          categoryLabel: CATEGORY_LABEL[a.category as InterviewCategory] ?? a.category,
          questionText: a.questionText,
          text: a.text,
          skipped: a.skipped,
          edited: a.revisions.length > 0,
          extraction: a.extraction,
          extractionStatus: a.extractionStatus,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
