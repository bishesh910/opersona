import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/session';
import { getProfileAccess } from '@/lib/clones';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { CloneTabs } from '@/components/shell/CloneTabs';

export default async function CloneLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getProfileAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const { clone, canWrite } = access;
  return (
    <div className="mx-auto max-w-5xl space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <AvatarThumb recipe={clone.avatarRecipe} name={clone.name} scale={2} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight sm:text-xl">{clone.name}</h1>
          <div className="muted text-xs">{clone.kind === 'imported' ? 'Imported copy — it thinks like its author but never learns about them' : canWrite ? 'Your persona' : 'Public profile — what this persona shares with the org'}</div>
        </div>
      </div>
      <div className="sticky top-0 z-10 -mx-3 bg-white/95 px-3 backdrop-blur-sm md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none dark:bg-neutral-950/95 md:dark:bg-transparent">
        <CloneTabs cloneId={clone.id} isOwner={access.isOwner} kind={clone.kind} />
      </div>
      <div>{children}</div>
    </div>
  );
}
