import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';

export type ImportJobRow = {
  id: string; filename: string; status: 'queued' | 'running' | 'done' | 'failed';
  total: number; processed: number; skipped: number; observations: number; error: string | null; createdAt: string;
};

/** Recent claude.ai-history import jobs for a persona (serialisable for client components). */
export async function listImportJobs(cloneId: string): Promise<ImportJobRow[]> {
  const rows = await db.select().from(schema.importJobs).where(eq(schema.importJobs.cloneId, cloneId)).orderBy(desc(schema.importJobs.createdAt)).limit(20);
  return rows.map((j) => ({
    id: j.id, filename: j.filename, status: j.status, total: j.total, processed: j.processed, skipped: j.skipped,
    observations: j.observations, error: j.error, createdAt: j.createdAt.toISOString(),
  }));
}
