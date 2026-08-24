import { notFound } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { DocumentsPanel } from '@/components/documents/DocumentsPanel';

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, rawId);
  if (!access) notFound();
  const id = access.clone.id;
  const docs = await db
    .select({
      id: schema.documents.id, filename: schema.documents.filename, mime: schema.documents.mime, bytes: schema.documents.bytes,
      createdAt: schema.documents.createdAt, chunks: count(schema.documentChunks.id),
    })
    .from(schema.documents)
    .leftJoin(schema.documentChunks, eq(schema.documentChunks.documentId, schema.documents.id))
    .where(eq(schema.documents.cloneId, id))
    .groupBy(schema.documents.id)
    .orderBy(desc(schema.documents.createdAt));
  return (
    <DocumentsPanel
      cloneId={id}
      readOnly={!access.canWrite}
      documents={docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
    />
  );
}
