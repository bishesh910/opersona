import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/session';
import { getProfileAccess } from '@/lib/clones';
import { AvatarEditor } from '@/components/avatar/AvatarEditor';

export default async function AvatarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getProfileAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  return <AvatarEditor cloneId={id} initial={access.clone.avatarRecipe ?? null} readOnly={!access.canWrite} />;
}
