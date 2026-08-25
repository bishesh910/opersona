import { requireOrg, require2FA } from '@/lib/session';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { SideNav } from '@/components/shell/SideNav';
import { UserMenu } from '@/components/shell/UserMenu';
import { ChatSearch } from '@/components/shell/ChatSearch';
import { SidebarChats } from '@/components/shell/SidebarChats';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  await require2FA(ctx);
  const [own] = await db.select({ id: schema.clones.id, r: schema.clones.avatarRecipe }).from(schema.clones).where(eq(schema.clones.ownerUserId, ctx.userId)).limit(1);
  const recentChats = own
    ? (await db.select({ id: schema.conversations.id, slug: schema.conversations.slug, title: schema.conversations.title, pinned: schema.conversations.pinned })
        .from(schema.conversations)
        .where(and(eq(schema.conversations.cloneId, own.id), eq(schema.conversations.userId, ctx.userId)))
        .orderBy(desc(schema.conversations.pinned), desc(schema.conversations.lastActivityAt)).limit(20))
        .map((c) => ({ id: c.id, slug: c.slug, pinned: c.pinned, title: /^(New chat|Persona test)/.test(c.title) ? 'New chat' : c.title }))
    : [];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col self-start border-r border-neutral-200 bg-neutral-50 p-4 md:flex dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mb-6 px-2 text-lg font-semibold tracking-tight">opersona</div>
        <SideNav include={['/chat']} />
        <SidebarChats items={recentChats} />
        <div className={recentChats.length ? 'mt-3' : 'mt-auto'}>
          <SideNav include={['/approvals']} />
        </div>
        <div className="relative mt-auto -mx-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <UserMenu name={ctx.user.name} email={ctx.user.email} avatarRecipe={own?.r ?? null} dropUp compact />
            <ChatSearch anchorToContainer />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-neutral-200 px-4 md:hidden dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <span className="font-medium">{ctx.orgName}</span>
            <span className="chip">{ctx.role}</span>
          </div>
          <UserMenu name={ctx.user.name} email={ctx.user.email} avatarRecipe={own?.r ?? null} />
        </header>
        <div className="md:hidden">{/* wrapper owns the breakpoint: .nav-scroll's display:flex would out-specificity md:hidden */}
          <nav className="nav-scroll gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <SideNav horizontal />
          </nav>
        </div>
        <main className="min-w-0 flex-1 overflow-x-clip px-3 py-3 md:px-6 md:py-4">{children}</main>
      </div>
    </div>
  );
}
