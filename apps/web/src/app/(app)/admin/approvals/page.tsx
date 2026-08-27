import { notFound } from 'next/navigation';
import { asc, isNull } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/auth';
import { ApprovalRow } from '@/components/admin/ApprovalRow';

export const metadata = { title: 'Account approvals' };
export const dynamic = 'force-dynamic';

/** The admission queue: every open-signup account waits here for a human yes. */
export default async function ApprovalsAdminPage() {
  const ctx = await requireOrg();
  if (!isPlatformAdmin(ctx.user.email)) notFound();
  const pending = await db.select({
    id: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email,
    emailVerified: authSchema.user.emailVerified, createdAt: authSchema.user.createdAt,
  }).from(authSchema.user).where(isNull(authSchema.user.approvedAt)).orderBy(asc(authSchema.user.createdAt)).limit(200);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Account approvals</h1>
        <p className="muted mt-1 text-sm">People who signed up and are waiting to be let in. They see a friendly waiting page until you decide.</p>
      </div>
      {pending.length === 0 ? (
        <p className="card muted p-5 text-sm">Nobody waiting. The door is quiet.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((u) => (
            <ApprovalRow key={u.id} id={u.id} name={u.name} email={u.email}
              emailVerified={u.emailVerified} createdAt={u.createdAt.toISOString()} />
          ))}
        </ul>
      )}
      <p className="muted text-xs">Reports queue lives at <a className="underline" href="/admin/moderation">/admin/moderation</a>.</p>
    </div>
  );
}
