import { eq, inArray } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';

/** Who's in the org: email, role, joined, and how far they got (persona built? 2FA on?). */
export async function MembersCard({ orgId }: { orgId: string }) {
  const members = await db
    .select({ role: authSchema.member.role, joined: authSchema.member.createdAt, uid: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email, tfa: authSchema.user.twoFactorEnabled })
    .from(authSchema.member)
    .innerJoin(authSchema.user, eq(authSchema.user.id, authSchema.member.userId))
    .where(eq(authSchema.member.organizationId, orgId));
  const uids = members.map((m) => m.uid);
  const clones = uids.length
    ? await db.select({ owner: schema.clones.ownerUserId }).from(schema.clones).where(inArray(schema.clones.ownerUserId, uids))
    : [];
  const hasClone = new Set(clones.map((c) => c.owner));
  return (
    <section className="card">
      <h2 className="font-medium">Members</h2>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
        {members.map((m) => (
          <li key={m.uid} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{m.name}</div>
              <div className="muted truncate text-xs">{m.email} · joined {m.joined.toLocaleDateString()}</div>
            </div>
            <span className="chip">{m.role}</span>
            <span className={`chip ${hasClone.has(m.uid) ? 'border-green-500 text-green-700 dark:text-green-400' : 'border-amber-400 text-amber-700 dark:text-amber-400'}`}>{hasClone.has(m.uid) ? 'persona ✓' : 'no persona yet'}</span>
            <span className={`chip ${m.tfa ? 'border-green-500 text-green-700 dark:text-green-400' : 'border-amber-400 text-amber-700 dark:text-amber-400'}`}>{m.tfa ? '2FA ✓' : 'no 2FA'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
