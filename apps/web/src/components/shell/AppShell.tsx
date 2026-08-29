import Link from 'next/link';
import { headers } from 'next/headers';
import { SidebarResizer, SidebarToggle } from '@/components/shell/SidebarResizer';
import { requireOrg, require2FA } from '@/lib/session';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { SideNav } from '@/components/shell/SideNav';
import { UserMenu } from '@/components/shell/UserMenu';
import { SidebarFooter } from '@/components/shell/SidebarFooter';
import { PersonaProgress } from '@/components/shell/PersonaProgress';
import { BridgeNavButton } from '@/components/shell/BridgeNavButton';
import { buildProgress } from '@/lib/persona-progress';

/** The signed-in chrome: sidebar, mobile strip, user menu. Used by the (app)
 * layout and — when a session exists — by the (public) layout, so community
 * pages keep the real nav instead of dumping you outside the app. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const ctx = await requireOrg();
  await require2FA(ctx);
  const [own] = await db.select({ id: schema.clones.id, r: schema.clones.avatarRecipe }).from(schema.clones).where(eq(schema.clones.ownerUserId, ctx.userId)).limit(1);
  const progress = await buildProgress(ctx.userId, ctx.orgId, own?.id);
  return (
    <div data-app-shell className="flex h-dvh overflow-hidden overscroll-none">
      {/* sidebar width/collapse persist per device; applied pre-paint (no flash) */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "(function(){try{var w=parseInt(localStorage.getItem('sb.w'),10);var c=localStorage.getItem('sb.collapsed')==='1';if(!(w>=180&&w<=400))w=224;document.documentElement.style.setProperty('--sb-w',(c?0:w)+'px');if(c)document.documentElement.setAttribute('data-sb-collapsed','');}catch(e){}})()" }} />
      <aside style={{ width: 'var(--sb-w, 224px)' }} className="app-sidebar relative hidden h-full shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 p-4 md:flex dark:border-neutral-800 dark:bg-neutral-900/40">
        <Link href="/me" className="mb-6 block px-2 text-lg font-semibold tracking-tight">opersona.me</Link>
        <SideNav include={['/me']} />
        <SideNav include={['/opersonas']} />
        <SideNav include={['/explore']} />
        <div className="mt-4 space-y-0.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <PersonaProgress data={progress} />
          <BridgeNavButton />
        </div>
        <div className="relative mt-auto -mx-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800">
          <SidebarFooter name={ctx.user.name} email={ctx.user.email} avatarRecipe={own?.r ?? null} />
        </div>
        <SidebarToggle />
      </aside>
      <SidebarResizer />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between border-b border-neutral-200 px-4 md:hidden dark:border-neutral-800">
          <Link href="/me" className="text-base font-semibold tracking-tight">opersona.me</Link>
          <div className="flex items-center gap-2">
            <BridgeNavButton variant="dot" />
            <UserMenu name={ctx.user.name} email={ctx.user.email} avatarRecipe={own?.r ?? null} />
          </div>
        </header>
        <div className="md:hidden">{/* wrapper owns the breakpoint: .nav-scroll's display:flex would out-specificity md:hidden */}
          <nav className="flex items-center gap-1 whitespace-nowrap border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
            <SideNav horizontal include={['/me']} />
            <SideNav horizontal include={['/opersonas']} />
            <SideNav horizontal include={['/explore']} />
            <div className="ml-auto shrink-0"><PersonaProgress data={progress} variant="pill" /></div>
          </nav>
        </div>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain px-3 py-3 md:px-6 md:py-4">{children}</main>
      </div>
    </div>
  );
}
