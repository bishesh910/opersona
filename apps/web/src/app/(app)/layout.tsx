import Link from 'next/link';
import { headers } from 'next/headers';
import { SidebarResizer, SidebarToggle } from '@/components/shell/SidebarResizer';
import { requireOrg, require2FA } from '@/lib/session';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { SideNav } from '@/components/shell/SideNav';
import { UserMenu } from '@/components/shell/UserMenu';
import { SidebarFooter } from '@/components/shell/SidebarFooter';
import { RecentChats } from '@/components/chat/RecentChats';
import { SidebarChats } from '@/components/shell/SidebarChats';
import { TalkToPersona } from '@/components/shell/TalkToPersona';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const ctx = await requireOrg();
  await require2FA(ctx);
  const [own] = await db.select({ id: schema.clones.id, r: schema.clones.avatarRecipe }).from(schema.clones).where(eq(schema.clones.ownerUserId, ctx.userId)).limit(1);
  const convRows = await db.select({
      id: schema.conversations.id, slug: schema.conversations.slug, title: schema.conversations.title,
      pinned: schema.conversations.pinned, mode: schema.conversations.mode, cloneId: schema.conversations.cloneId, at: schema.conversations.lastActivityAt,
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
      when: c.at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    };
  });
  const personaOptions = (await db.select({ cloneId: schema.clones.id, name: schema.clones.name, recipe: schema.clones.avatarRecipe })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId)))
    .map((c) => ({ cloneId: c.cloneId, name: c.name, recipe: c.recipe, mine: !!own && c.cloneId === own.id }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  return (
    <div data-app-shell className="flex h-dvh overflow-hidden overscroll-none">
      {/* sidebar width/collapse persist per device; applied pre-paint (no flash) */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var w=parseInt(localStorage.getItem('sb.w'),10);var c=localStorage.getItem('sb.collapsed')==='1';if(!(w>=180&&w<=400))w=224;document.documentElement.style.setProperty('--sb-w',(c?0:w)+'px');if(c)document.documentElement.setAttribute('data-sb-collapsed','');}catch(e){}})()" }} />
      <aside style={{ width: 'var(--sb-w, 224px)' }} className="app-sidebar relative hidden h-full shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 p-4 md:flex dark:border-neutral-800 dark:bg-neutral-900/40">
        <Link href="/chat" className="mb-6 block px-2 text-lg font-semibold tracking-tight">opersona.me</Link>
        <SideNav include={['/chat']} />
        <SideNav include={['/command-center']} />
        <div className="my-2 border-t border-neutral-200 dark:border-neutral-800" />
        <TalkToPersona options={personaOptions} />
        <div className="my-3 border-t border-neutral-200 dark:border-neutral-800" />
        <SidebarChats items={recentChats} />
        <div className={(recentChats.length ? 'mt-3 ' : 'mt-auto ') + 'border-t border-neutral-200 py-2 dark:border-neutral-800'}>
          <SideNav include={['/approvals']} />
        </div>
        <div className="relative mt-auto -mx-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800">
          <SidebarFooter name={ctx.user.name} email={ctx.user.email} avatarRecipe={own?.r ?? null} />
        </div>
        <SidebarToggle />
      </aside>
      <SidebarResizer />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-neutral-200 px-4 md:hidden dark:border-neutral-800">
          <Link href="/chat" className="text-base font-semibold tracking-tight">opersona.me</Link>
          <div className="flex items-center gap-2">
            <Link
              href="/command-center"
              aria-label="Command Center (beta)"
              title="Command Center (beta)"
              className="grid h-8 w-8 place-items-center rounded-lg border border-amber-300/70 bg-amber-50 font-mono text-[11px] font-bold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/70"
            >&gt;_</Link>
            <UserMenu name={ctx.user.name} email={ctx.user.email} avatarRecipe={own?.r ?? null} />
          </div>
        </header>
        <div className="md:hidden">{/* wrapper owns the breakpoint: .nav-scroll's display:flex would out-specificity md:hidden */}
          <nav className="flex items-center gap-1 whitespace-nowrap border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
            <SideNav horizontal include={['/chat']} />
            <TalkToPersona variant="strip" options={personaOptions} />
            <RecentChats variant="strip" currentSlug="" items={recentChats.filter((c) => c.mine).map((c) => ({ slug: c.slug, title: c.title, when: c.when }))} />
            <SideNav horizontal include={['/approvals']} />
          </nav>
        </div>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain px-3 py-3 md:px-6 md:py-4">{children}</main>
      </div>
    </div>
  );
}
