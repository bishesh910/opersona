import { notFound } from 'next/navigation';
import { desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/auth';
import { ReportRow } from '@/components/community/ReportRow';

export const metadata = { title: 'Moderation' };

/** Report queue — the platform's ONLY editorial lever (owner-sovereign everywhere else). */
export default async function ModerationPage() {
  const ctx = await requireOrg();
  if (!isPlatformAdmin(ctx.user.email)) notFound();
  const open = await db.select({
    id: schema.personaReports.id,
    reason: schema.personaReports.reason,
    details: schema.personaReports.details,
    createdAt: schema.personaReports.createdAt,
    slug: schema.publishedPersonas.slug,
    status: schema.publishedPersonas.status,
    name: schema.publishedPersonas.artifact,
  }).from(schema.personaReports)
    .innerJoin(schema.publishedPersonas, eq(schema.publishedPersonas.id, schema.personaReports.publishedId))
    .where(isNull(schema.personaReports.resolvedAt))
    .orderBy(desc(schema.personaReports.createdAt)).limit(100);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Moderation — open reports</h1>
      {open.length === 0 ? (
        <p className="card muted p-5 text-sm">Queue is empty. Nice internet today.</p>
      ) : (
        <ul className="space-y-3">
          {open.map((r) => (
            <ReportRow key={r.id} id={r.id} slug={r.slug} personaName={r.name.persona.name}
              reason={r.reason} details={r.details} status={r.status} createdAt={r.createdAt.toISOString()} />
          ))}
        </ul>
      )}
    </div>
  );
}
