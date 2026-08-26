import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { OfficeScene, type OfficeMember } from '@/components/office/OfficeScene';

export const metadata = { title: 'Office' };

/**
 * Office — the org floor. Shows only org-visible identity (name + Pixie),
 * consistent with the privacy model: ambient pixel life, not presence
 * tracking — nobody's real activity is displayed here.
 */
export default async function OfficePage() {
  const ctx = await requireOrg();
  const clones = await db
    .select({ id: schema.clones.id, name: schema.clones.name, avatarRecipe: schema.clones.avatarRecipe, ownerUserId: schema.clones.ownerUserId })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId)).orderBy(desc(schema.clones.createdAt));
  const memberRows = await db
    .select({ uid: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email })
    .from(authSchema.member).innerJoin(authSchema.user, eq(authSchema.user.id, authSchema.member.userId))
    .where(eq(authSchema.member.organizationId, ctx.orgId));
  const ownerIds = [...new Set(clones.map((c) => c.ownerUserId))];
  const owners = ownerIds.length
    ? await db.select({ id: authSchema.user.id, name: authSchema.user.name }).from(authSchema.user).where(inArray(authSchema.user.id, ownerIds))
    : [];
  const ownerOf = new Map(owners.map((o) => [o.id, o.name]));
  const builders = new Set(clones.map((c) => c.ownerUserId));

  const members: OfficeMember[] = [
    ...clones.map((c) => ({
      cloneId: c.id,
      name: c.name || ownerOf.get(c.ownerUserId) || 'Pixie',
      owner: ownerOf.get(c.ownerUserId) ?? '',
      recipe: c.avatarRecipe,
      mine: c.ownerUserId === ctx.userId,
    })),
    // colleagues who joined but haven't built a persona yet still get a body on the floor
    ...memberRows.filter((m) => !builders.has(m.uid)).map((m) => ({
      cloneId: null,
      name: m.name || m.email.split('@')[0] || 'New hire',
      owner: m.name,
      recipe: null,
      mine: m.uid === ctx.userId,
    })),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Office</h1>
        <p className="muted text-sm">{ctx.orgName} — the whole floor. Click a Pixie to say hi.</p>
      </div>
      <OfficeScene members={members} />
      <p className="muted text-xs">
        The strolling is ambient animation, not activity tracking — nothing here reflects what anyone
        is actually doing.
      </p>
    </div>
  );
}
