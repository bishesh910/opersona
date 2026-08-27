import { CommunityHeader } from '@/components/community/CommunityHeader';

/**
 * Public layout — every page reachable without the app shell (explore, persona
 * profiles, privacy, whatever comes next) gets the same nav bar: brand on the
 * left, doors on the right (workspace/share when signed in, sign-in/up when not).
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <CommunityHeader />
      {children}
    </div>
  );
}
