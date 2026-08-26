import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { engineFetch } from '@/lib/engine';
import { OfficeShell } from '@/components/office/OfficeShell';
import type { PanelMember } from '@/components/office/PersonaPanel';

export const metadata = { title: 'Office' };

/**
 * Office — the org floor, munder-difflin style. Everything shown is
 * org-visible identity (name, Pixie, role/team, accuracy, confirmed pattern
 * descriptions — the colleague view of /clones/[id]/thinking). The floor
 * itself is ambient animation, never anyone's real activity.
 */
export default async function OfficePage() {
  const ctx = await requireOrg();
  const clones = await db
    .select({ id: schema.clones.id, name: schema.clones.name, avatarRecipe: schema.clones.avatarRecipe, ownerUserId: schema.clones.ownerUserId })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId)).orderBy(desc(schema.clones.createdAt));
  const memberRows = await db
    .select({ uid: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email, role: authSchema.member.role })
    .from(authSchema.member).innerJoin(authSchema.user, eq(authSchema.user.id, authSchema.member.userId))
    .where(eq(authSchema.member.organizationId, ctx.orgId));
  const ids = clones.map((c) => c.id);
  const [briefs, statusRows] = await Promise.all([
    ids.length
      ? db.select({ cloneId: schema.personaBriefs.cloneId, roleTitle: schema.personaBriefs.roleTitle, team: schema.personaBriefs.team })
          .from(schema.personaBriefs).where(inArray(schema.personaBriefs.cloneId, ids))
      : Promise.resolve([]),
    ids.length
      ? db.select({ cloneId: schema.reasoningPatterns.cloneId, dimension: schema.reasoningPatterns.dimension, description: schema.reasoningPatterns.description, status: schema.reasoningPatterns.status })
          .from(schema.reasoningPatterns).where(inArray(schema.reasoningPatterns.cloneId, ids))
      : Promise.resolve([]),
  ]);
  const patternsOf = new Map<string, { dimension: string; description: string }[]>();
  for (const p of statusRows) {
    if (p.status !== 'confirmed') continue;
    const arr = patternsOf.get(p.cloneId) ?? [];
    if (arr.length < 8) arr.push({ dimension: p.dimension, description: p.description });
    patternsOf.set(p.cloneId, arr);
  }
  const ownerOf = new Map(memberRows.map((o) => [o.uid, o.name]));
  const accs = await Promise.all(clones.map((c) =>
    engineFetch<{ pct: number | null }>(`/clones/${c.id}/accuracy`, { query: { orgId: ctx.orgId } })
      .then((a) => a.pct).catch(() => null)));
  const briefOf = new Map(briefs.map((b) => [b.cloneId, b]));
  const builders = new Set(clones.map((c) => c.ownerUserId));
  const bossUid = memberRows.find((r) => r.role === 'owner')?.uid ?? memberRows[0]?.uid;

  const members: PanelMember[] = [
    ...clones.map((c, i) => ({
      id: c.id,
      key: c.id,
      name: c.name || ownerOf.get(c.ownerUserId) || 'Pixie',
      owner: ownerOf.get(c.ownerUserId) ?? '',
      mine: c.ownerUserId === ctx.userId,
      boss: c.ownerUserId === bossUid,
      recipe: c.avatarRecipe,
      role: briefOf.get(c.id)?.roleTitle ?? '',
      team: briefOf.get(c.id)?.team ?? '',
      accuracyPct: accs[i] ?? null,
      patterns: patternsOf.get(c.id) ?? [],
    })),
    ...memberRows.filter((m) => !builders.has(m.uid)).map((m) => ({
      id: null,
      key: `u-${m.uid}`,
      name: m.name || m.email.split('@')[0] || 'New hire',
      owner: m.name,
      mine: m.uid === ctx.userId,
      boss: m.uid === bossUid,
      recipe: null,
      role: '',
      team: '',
      accuracyPct: null,
      patterns: [],
    })),
  ];

  return (
    <div className="flex h-[calc(100dvh-180px)] min-h-[440px] flex-col gap-3 md:h-[calc(100dvh-130px)]">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Office</h1>
          <p className="muted text-sm">{ctx.orgName} — drag to pan, scroll to zoom, click a Pixie.</p>
        </div>
        <p className="muted hidden text-xs sm:block">ambient animation — never anyone&apos;s real activity</p>
      </div>
      <div className="min-h-0 flex-1">
        <OfficeShell members={members} />
      </div>
    </div>
  );
}
