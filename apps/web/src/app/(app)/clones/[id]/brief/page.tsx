import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getProfileAccess } from '@/lib/clones';
import { BriefForm } from '@/components/brief/BriefForm';

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getProfileAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const [brief] = await db.select().from(schema.personaBriefs).where(eq(schema.personaBriefs.cloneId, id)).limit(1);
  return (
    <BriefForm
      cloneId={id}
      readOnly={!access.canWrite}
      initial={{
        displayName: brief?.displayName ?? access.clone.name,
        roleTitle: brief?.roleTitle ?? '',
        team: brief?.team ?? '',
        briefMd: brief?.briefMd ?? '',
        operatingRules: brief?.operatingRules ?? '',
      }}
    />
  );
}
