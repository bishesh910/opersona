import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { CloneTabs } from '@/components/shell/CloneTabs';

export default async function CloneLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const { clone, canWrite } = access;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <AvatarThumb recipe={clone.avatarRecipe} name={clone.name} scale={2} />
        <div>
          <h1 className="text-xl font-semibold leading-tight">{clone.name}</h1>
          <div className="muted text-xs">{canWrite ? 'Your persona' : 'Read-only (org admin view)'}</div>
        </div>
      </div>
      <CloneTabs cloneId={clone.id} isOwner={access.isOwner} />
      <div>{children}</div>
    </div>
  );
}
