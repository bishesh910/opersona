import Link from 'next/link';
import { headers } from 'next/headers';
import { SidebarResizer, SidebarToggle } from '@/components/shell/SidebarResizer';
import { requireOrg, require2FA } from '@/lib/session';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { SideNav } from '@/components/shell/SideNav';
import { UserMenu } from '@/components/shell/UserMenu';
import { SidebarFooter } from '@/components/shell/SidebarFooter';
import { PersonaProgress, type ProgressData } from '@/components/shell/PersonaProgress';
import { BridgeNavButton } from '@/components/shell/BridgeNavButton';
import { INTERVIEW_CATEGORIES } from '@opersona/shared';

/** Build-progress heuristic for the nav bar. Honest about being a heuristic
 *  (the guide panel itemizes it): connector 20 · interview started 10 ·
 *  interview coverage 45 · confirmed patterns 10 (full at 3) · scored blind
 *  scenarios 15 (full at 5). Untouched interview categories count as zero
 *  coverage — the average is over ALL categories, not just visited ones. */
async function buildProgress(userId: string, orgId: string, cloneId: string | undefined): Promise<ProgressData> {
  const [consent] = await db.select({ id: authSchema.oauthConsent.id }).from(authSchema.oauthConsent)
    .where(eq(authSchema.oauthConsent.userId, userId)).limit(1);
  const connector = !!consent;
  if (!cloneId) return { pct: connector ? 20 : 0, connector, answered: 0, coveragePct: 0, patterns: 0, scored: 0, bridgePaired: false };
  const [[cov], [pat], [sc], [btok]] = await Promise.all([
    db.select({ sum: sql<number>`coalesce(sum(${schema.interviewCoverage.coverage}), 0)`, answered: sql<number>`coalesce(sum(${schema.interviewCoverage.answered}), 0)::int` })
      .from(schema.interviewCoverage).where(eq(schema.interviewCoverage.cloneId, cloneId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.reasoningPatterns)
      .where(and(eq(schema.reasoningPatterns.cloneId, cloneId), eq(schema.reasoningPatterns.status, 'confirmed'))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.predictionScenarios)
      .where(and(eq(schema.predictionScenarios.cloneId, cloneId), eq(schema.predictionScenarios.status, 'scored'))),
    db.select({ id: schema.bridgeTokens.id }).from(schema.bridgeTokens)
      .where(and(eq(schema.bridgeTokens.orgId, orgId), isNull(schema.bridgeTokens.revokedAt))).limit(1),
  ]);
  const coverage = Math.max(0, Math.min(1, (cov?.sum ?? 0) / INTERVIEW_CATEGORIES.length));
  const answered = cov?.answered ?? 0;
  const patterns = pat?.n ?? 0;
  const scored = sc?.n ?? 0;
  const pct = Math.round(
    (connector ? 20 : 0) + (answered > 0 ? 10 : 0) + 45 * coverage
    + 10 * Math.min(patterns / 3, 1) + 15 * Math.min(scored / 5, 1),
  );
  return { pct: Math.min(100, pct), connector, answered, coveragePct: Math.round(coverage * 100), patterns, scored, bridgePaired: !!btok };
}

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
