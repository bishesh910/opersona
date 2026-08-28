import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { InterviewRoom } from '@/components/interview/InterviewRoom';

export const dynamic = 'force-dynamic';

/** The cognitive interview — strictly the owner teaching their own persona. */
export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access?.isOwner || !access.canWrite) notFound();
  return <InterviewRoom cloneId={access.clone.id} />;
}
