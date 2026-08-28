import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { SimulatePanel } from '@/components/simulate/SimulatePanel';

export const dynamic = 'force-dynamic';

/** Simulation — the owner asking their own behavioural model what they'd do. */
export default async function SimulatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access?.isOwner || !access.canWrite) notFound();
  const rows = await db.select().from(schema.simulations)
    .where(eq(schema.simulations.cloneId, access.clone.id))
    .orderBy(desc(schema.simulations.createdAt)).limit(10);
  return (
    <SimulatePanel
      cloneId={access.clone.id}
      history={rows.map((r) => ({
        id: r.id, mode: r.mode, text: r.input.text, answer: r.output.answer,
        confidence: r.output.confidence, createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}
