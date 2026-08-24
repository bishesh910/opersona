import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg, isOrgAdmin } from '@/lib/session';
import { ApprovalsList } from '@/components/approvals/ApprovalsList';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const ctx = await requireOrg();
  // Persona owners see their own clone's approvals; org owner/admin see every clone in the org.
  const cloneRows = await db.select({ id: schema.clones.id, name: schema.clones.name, ownerUserId: schema.clones.ownerUserId })
    .from(schema.clones)
    .where(isOrgAdmin(ctx) ? eq(schema.clones.orgId, ctx.orgId) : and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.ownerUserId, ctx.userId)));
  const cloneIds = cloneRows.map((c) => c.id);
  const pending = cloneIds.length
    ? await db.select().from(schema.approvals)
        .where(and(eq(schema.approvals.orgId, ctx.orgId), eq(schema.approvals.status, 'pending'), inArray(schema.approvals.cloneId, cloneIds)))
        .orderBy(desc(schema.approvals.createdAt)).limit(200)
    : [];
  const nameOf = new Map(cloneRows.map((c) => [c.id, c]));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Pending approvals</h1>
      <p className="muted text-sm">Tool calls and questions your persona is waiting on. Unanswered requests expire after 10 minutes.</p>
      <ApprovalsList
        items={pending.map((a) => {
          const c = nameOf.get(a.cloneId);
          return {
            id: a.id, cloneId: a.cloneId, cloneName: c?.name ?? a.cloneId, conversationId: a.conversationId,
            kind: a.kind, tool: a.tool ?? '', input: a.input, question: a.question ?? undefined, options: a.options ?? undefined,
            createdAt: a.createdAt.toISOString(),
            canResolve: c?.ownerUserId === ctx.userId || ctx.role === 'owner',
          };
        })}
      />
    </div>
  );
}
