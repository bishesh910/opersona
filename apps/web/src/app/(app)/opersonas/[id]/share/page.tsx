import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { publishState } from '@/actions/publish';
import { ShareCard } from '@/components/community/ShareCard';

export const metadata = { title: 'Share persona' };

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, id);
  if (!access?.isOwner || access.clone.kind !== 'member') notFound();
  const state = await publishState(access.clone.id);
  return <ShareCard cloneId={access.clone.id} name={access.clone.name} initial={state} />;
}
