import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getProfileAccess } from '@/lib/clones';
import { PersonalityCard } from '@/components/brief/PersonalityCard';

export const dynamic = 'force-dynamic';

export default async function PersonalityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getProfileAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const [personality] = await db
    .select()
    .from(schema.personalityTests)
    .where(eq(schema.personalityTests.cloneId, id))
    .orderBy(desc(schema.personalityTests.createdAt))
    .limit(1);
  return (
    <PersonalityCard
      cloneId={id}
      readOnly={!access.canWrite}
      latest={personality ? { type: personality.type, scores: personality.scores } : null}
    />
  );
}
