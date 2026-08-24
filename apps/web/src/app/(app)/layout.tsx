import { requireOrg, require2FA } from '@/lib/session';
import { SideNav } from '@/components/shell/SideNav';
import { UserMenu } from '@/components/shell/UserMenu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  await require2FA(ctx);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4 md:block dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mb-6 px-2 text-lg font-semibold tracking-tight">opersona</div>
        <SideNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <span className="font-medium">{ctx.orgName}</span>
            <span className="chip">{ctx.role}</span>
          </div>
          <UserMenu name={ctx.user.name} email={ctx.user.email} />
        </header>
        <nav className="nav-scroll gap-2 border-b border-neutral-200 px-3 py-2 md:hidden dark:border-neutral-800">
          <SideNav horizontal />
        </nav>
        <main className="min-w-0 flex-1 overflow-x-clip px-3 py-3 md:px-6 md:py-4">{children}</main>
      </div>
    </div>
  );
}
