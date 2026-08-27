import { getSessionCtx, getOrgCtx } from '@/lib/session';
import { AppShell } from '@/components/shell/AppShell';
import { CommunityHeader } from '@/components/community/CommunityHeader';

/**
 * Public pages (explore, persona profiles, privacy) are readable by anyone —
 * but a signed-in person keeps the REAL app nav around them: same sidebar,
 * same doors, no dead end. Logged-out visitors get the light community bar.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionCtx();
  const org = session ? await getOrgCtx(session) : null;
  if (session && org) {
    return <AppShell><div className="mx-auto max-w-3xl">{children}</div></AppShell>;
  }
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <CommunityHeader />
      {children}
    </div>
  );
}
