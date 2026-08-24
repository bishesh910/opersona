/**
 * Claude-history import.
 *  POST multipart `file` (.zip export or conversations.json, ≤200MB) → row in `import_jobs`, file saved to
 *       ENGINE_DATA_DIR/orgs/<org>/uploads/import-<importId>, then the engine starts processing in the background.
 *  GET  → recent import jobs for the persona (polled by the "How I think" page while a job is queued/running).
 */
import { NextResponse, type NextRequest } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getSessionCtx, getOrgCtx } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { engineDataDir } from '@/lib/env';
import { listImportJobs } from '@/lib/imports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.zip', '.json']);

async function auth(cloneId: string) {
  const s = await getSessionCtx();
  if (!s) return { res: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  const ctx = await getOrgCtx(s);
  if (!ctx) return { res: NextResponse.json({ error: 'no organization' }, { status: 403 }) };
  const access = await getCloneAccess(ctx, cloneId);
  if (!access) return { res: NextResponse.json({ error: 'clone not found' }, { status: 404 }) };
  return { ctx, access };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cloneId } = await params;
  const a = await auth(cloneId);
  if ('res' in a) return a.res;
  return NextResponse.json({ jobs: await listImportJobs(cloneId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cloneId } = await params;
  const a = await auth(cloneId);
  if ('res' in a) return a.res;
  const { ctx, access } = a;
  if (!access.canWrite) return NextResponse.json({ error: 'only the persona owner can import their history' }, { status: 403 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'expected multipart form' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file exceeds 200MB' }, { status: 413 });
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: 'upload the export .zip or its conversations.json' }, { status: 415 });
  const filename = path.basename(file.name).replace(/[^\w.\- ()]/g, '_').slice(0, 200) || `export${ext}`;

  const [job] = await db.insert(schema.importJobs)
    .values({ orgId: ctx.orgId, cloneId, userId: ctx.userId, filename })
    .returning({ id: schema.importJobs.id });
  const importId = job!.id;

  // Same location the documents upload uses, so the engine finds it under its data dir.
  const dir = path.join(engineDataDir(), 'orgs', ctx.orgId, 'uploads');
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await pipeline(
      Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream),
      fs.createWriteStream(path.join(dir, `import-${importId}`), { mode: 0o600 }),
    );
  } catch (e) {
    await db.delete(schema.importJobs).where(eq(schema.importJobs.id, importId));
    return NextResponse.json({ error: `could not store file: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  try {
    await engineFetch(`/imports/${importId}/start`, { body: { orgId: ctx.orgId } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(schema.importJobs).set({ status: 'failed', error: `could not start: ${msg}` }).where(eq(schema.importJobs.id, importId));
    return NextResponse.json({ id: importId, error: `Stored, but the import could not start: ${msg}` }, { status: 502 });
  }
  return NextResponse.json({ id: importId }, { status: 202 });
}
