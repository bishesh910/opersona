import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { FactList } from '@/components/memory/FactList';
import { PlaybookList } from '@/components/memory/PlaybookList';
import { PromptPanel } from '@/components/memory/PromptPanel';

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const [facts, playbooks] = await Promise.all([
    db.select().from(schema.facts).where(eq(schema.facts.cloneId, id)).orderBy(desc(schema.facts.pinned), desc(schema.facts.updatedAt)).limit(500),
    db.select().from(schema.playbooks).where(eq(schema.playbooks.cloneId, id)).orderBy(desc(schema.playbooks.updatedAt)).limit(200),
  ]);
  const ro = !access.canWrite;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <FactList
          cloneId={id}
          readOnly={ro}
          facts={facts.map((f) => ({ id: f.id, statement: f.statement, domain: f.domain, tags: f.tags, pinned: f.pinned, shareable: f.shareable, status: f.status, sourceKind: f.sourceKind, confidence: f.confidence }))}
        />
        <PlaybookList
          cloneId={id}
          readOnly={ro}
          playbooks={playbooks.map((p) => ({ id: p.id, name: p.name, domain: p.domain, trigger: p.trigger, preconditions: p.preconditions, steps: p.steps, pitfalls: p.pitfalls, shareable: p.shareable, status: p.status, version: p.version, sourceKind: p.sourceKind, outcomeStats: p.outcomeStats }))}
        />
      </div>
      <PromptPanel cloneId={id} />
    </div>
  );
}
