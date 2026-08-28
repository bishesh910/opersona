import { headers } from 'next/headers';
import { getSessionCtx, getOrgCtx } from '@/lib/session';
import { AppShell } from '@/components/shell/AppShell';
import { CommunityHeader } from '@/components/community/CommunityHeader';

/**
 * Public pages (explore, persona profiles, privacy, about) are readable by
 * anyone — a signed-in person keeps the REAL app nav around them (same
 * sidebar, same doors, no dead end), while logged-out visitors get the Night
 * Shift world the landing and sign-in live in: the starry skyline behind a
 * heavy scrim (the pixie crowd stays a faint silhouette, never the show) with
 * the pages rendering their dark variants via the `.dark` wrapper.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionCtx();
  const org = session ? await getOrgCtx(session) : null;
  if (session && org) {
    return <AppShell><div className="mx-auto max-w-3xl">{children}</div></AppShell>;
  }
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <div className="dark auth-bg relative min-h-dvh bg-[#07070c] text-neutral-100">
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var h=new Date().getHours();document.documentElement.setAttribute('data-daypart',h>=5&&h<11?'morning':h>=11&&h<18?'day':'night');}catch(e){}})()" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#07070c]/45 via-[#07070c]/70 to-[#07070c]/90" />
      <div className="relative mx-auto max-w-3xl px-5 py-6">
        <CommunityHeader />
        {children}
      </div>
    </div>
  );
}
