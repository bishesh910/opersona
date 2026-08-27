import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { CommandCenterView, type CCMember } from '@/components/office/CommandCenterView';

export const metadata = { title: 'Command Center' };

/**
 * Command Center — appoint a boss persona (★) that runs the floor: it
 * delegates work to whoever fits, hires temporary specialist personas, and
 * reports back with attribution. Team identity is org-visible; the Tasks tab
 * only ever shows YOUR delegations.
 */
export default async function CommandCenterPage() {
  const ctx = await requireOrg();
  const clones = await db
    .select({ id: schema.clones.id, name: schema.clones.name, avatarRecipe: schema.clones.avatarRecipe, ownerUserId: schema.clones.ownerUserId, kind: schema.clones.kind })
    .from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), isNull(schema.clones.archivedAt)))
    .orderBy(desc(schema.clones.createdAt));
  const [settings] = await db.select({ bossCloneId: schema.orgSettings.bossCloneId }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  const briefs = clones.length
    ? await db.select({ cloneId: schema.personaBriefs.cloneId, roleTitle: schema.personaBriefs.roleTitle }).from(schema.personaBriefs)
    : [];
  const roleOf = new Map(briefs.map((b) => [b.cloneId, b.roleTitle]));
  const owners = await db
    .select({ uid: authSchema.user.id, name: authSchema.user.name })
    .from(authSchema.member).innerJoin(authSchema.user, eq(authSchema.user.id, authSchema.member.userId))
    .where(eq(authSchema.member.organizationId, ctx.orgId));
  const ownerOf = new Map(owners.map((o) => [o.uid, o.name]));
  const bossCloneId = settings?.bossCloneId ?? null;

  const members: CCMember[] = clones.map((c) => ({
    id: c.id,
    name: c.name || ownerOf.get(c.ownerUserId) || 'Persona',
    recipe: c.avatarRecipe,
    role: roleOf.get(c.id) ?? '',
    hired: c.kind === 'hired',
    boss: c.id === bossCloneId,
    mine: c.ownerUserId === ctx.userId && c.kind === 'member',
  }));

  return (
    <div className="flex h-full min-h-[440px] flex-col">
      <CommandCenterView members={members} bossCloneId={bossCloneId} canStar={ctx.role === 'owner' || ctx.role === 'admin'} />
    </div>
  );
}
