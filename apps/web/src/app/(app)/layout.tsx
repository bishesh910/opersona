import { requireOrg, require2FA } from '@/lib/session';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { SideNav } from '@/components/shell/SideNav';
import { UserMenu } from '@/components/shell/UserMenu';
import { SidebarFooter } from '@/components/shell/SidebarFooter';
import { SidebarChats } from '@/components/shell/SidebarChats';
import { TalkToPersona } from '@/components/shell/TalkToPersona';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  await require2FA(ctx);
  const [own] = await db.select({ id: schema.clones.id, r: schema.clones.avatarRecipe }).from(schema.clones).where(eq(schema.clones.ownerUserId, ctx.userId)).limit(1);
  const convRows = await db.select({
      id: schema.conversations.id, slug: schema.conversations.slug, title: schema.conversations.title,
      pinned: schema.conversations.pinned, mode: schema.conversations.mode, cloneId: schema.conversations.cloneId,
      personaName: schema.clones.name,
    })
    .from(schema.conversations)
    .innerJoin(schema.clones, eq(schema.clones.id, schema.conversations.cloneId))
    .where(and(eq(schema.conversations.orgId, ctx.orgId), eq(schema.conversations.userId, ctx.userId)))
    .orderBy(desc(schema.conversations.pinned), desc(schema.conversations.lastActivityAt)).limit(20);
  const recentChats = convRows.map((c) => {
    const mine = !!own && c.cloneId === own.id;
    return {
      id: c.id, slug: c.slug, pinned: c.pinned,
      mode: (c.mode === 'clone' ? 'clone' : 'claude') as 'clone' | 'claude',
      mine,
      personaName: mine ? undefined : c.personaName,
      href: mine ? `/c/${c.slug}` : `/ask/${c.cloneId}/${c.slug}`,
      title: /^(New chat|Persona test|Asked by )/.test(c.title) ? 'Untitled' : c.title,
    };
  });
  const personaOptions = (await db.select({ cloneId: schema.clones.id, name: schema.clones.name, recipe: schema.clones.avatarRecipe })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId)))
    .map((c) => ({ cloneId: c.cloneId, name: c.name, recipe: c.recipe, mine: !!own && c.cloneId === own.id }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col self-start border-r border-neutral-200 bg-neutral-50 p-4 md:flex dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mb-6 px-2 text-lg font-semibold tracking-tight">opersona.me</div>
        <SideNav include={['/chat']} />
        <div className="my-2 border-t border-neutral-200 dark:border-neutral-800" />
        <TalkToPersona options={personaOptions} />
        <div className="my-3 border-t border-neutral-200 dark:border-neutral-800" />
        <SidebarChats items={recentChats} />
        <div className={(recentChats.length ? 'mt-3 ' : 'mt-auto ') + 'border-t border-neutral-200 py-2 dark:border-neutral-800'}>
          <SideNav include={['/approvals']} />
        </div>
        <div className="relative mt-auto -mx-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800">
          <SidebarFooter
            name={ctx.user.name}
            email={ctx.user.email}
            avatarRecipe={own?.r ?? null}
            roster={personaOptions.filter((o) => !o.mine).map((o) => ({ name: o.name, recipe: o.recipe ?? null }))}
          />
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
