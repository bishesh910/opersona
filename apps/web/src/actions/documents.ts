'use server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineDataDir } from '@/lib/env';
import type { ActionResult } from './brief';

export async function deleteDocumentAction(cloneId: string, documentId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) return { ok: false, error: 'Not allowed' };
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return { ok: false, error: 'bad id' };
  const [doc] = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, documentId), eq(schema.documents.cloneId, cloneId), eq(schema.documents.orgId, ctx.orgId))).limit(1);
  if (!doc) return { ok: false, error: 'Document not found' };
  await db.transaction(async (tx) => {
    await tx.delete(schema.documentChunks).where(eq(schema.documentChunks.documentId, documentId));
    await tx.delete(schema.documents).where(eq(schema.documents.id, documentId));
  });
  await fs.rm(path.join(engineDataDir(), 'orgs', ctx.orgId, 'uploads', documentId), { force: true });
  return { ok: true };
}
