/**
 * Document upload: multipart `file` → saved to ENGINE_DATA_DIR/orgs/<org>/uploads/<documentId>,
 * row in `documents`, then the engine ingests (extract + chunk) it.
 */
import { NextResponse, type NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getSessionCtx, getOrgCtx } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { engineFetch } from '@/lib/engine';
import { engineDataDir } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, string> = { '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf' };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: cloneId } = await params;
  const s = await getSessionCtx();
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const ctx = await getOrgCtx(s);
  if (!ctx) return NextResponse.json({ error: 'no organization' }, { status: 403 });
  const access = await getCloneAccess(ctx, cloneId);
  if (!access) return NextResponse.json({ error: 'clone not found' }, { status: 404 });
  if (!access.canWrite) return NextResponse.json({ error: 'read-only' }, { status: 403 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'expected multipart form' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file exceeds 10MB' }, { status: 413 });
  const ext = path.extname(file.name).toLowerCase();
  const mime = ALLOWED[ext];
  if (!mime) return NextResponse.json({ error: 'only .txt, .md and .pdf are accepted' }, { status: 415 });
  const filename = path.basename(file.name).replace(/[^\w.\- ()]/g, '_').slice(0, 200) || `upload${ext}`;

  const [doc] = await db.insert(schema.documents)
    .values({ orgId: ctx.orgId, cloneId, filename, mime, bytes: file.size, uploadedBy: ctx.userId })
    .returning({ id: schema.documents.id });
  const documentId = doc!.id;

  const dir = path.join(engineDataDir(), 'orgs', ctx.orgId, 'uploads');
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, documentId), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  } catch (e) {
    await db.delete(schema.documents).where(eq(schema.documents.id, documentId));
    return NextResponse.json({ error: `could not store file: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  try {
    const r = await engineFetch<{ chunks: number }>(`/documents/${documentId}/ingest`, { body: { orgId: ctx.orgId } });
    return NextResponse.json({ id: documentId, chunks: r.chunks });
  } catch (e) {
    return NextResponse.json({ id: documentId, chunks: 0, warning: `Stored, but ingest failed: ${e instanceof Error ? e.message : String(e)}. Use "Re-ingest".` });
  }
}
