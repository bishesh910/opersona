import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db, documents, documentChunks } from '@opersona/db';
import { redactSecrets } from '@opersona/shared';
import { uploadPath } from '../isolation/workspace.js';

const CHUNK = 1200, OVERLAP = 150;

async function extractText(path: string, mime: string): Promise<string> {
  const buf = await readFile(path);
  if (mime === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const r = await pdfParse(buf);
    return r.text;
  }
  return buf.toString('utf8');
}

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += CHUNK - OVERLAP) {
    const piece = clean.slice(i, i + CHUNK).trim();
    if (piece) out.push(piece);
    if (i + CHUNK >= clean.length) break;
  }
  return out;
}

export async function ingestDocument(orgId: string, documentId: string): Promise<number> {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.orgId, orgId))).limit(1);
  if (!doc) throw new Error('document not found');
  const text = redactSecrets(await extractText(uploadPath(orgId, documentId), doc.mime));
  const chunks = chunkText(text);
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
  if (chunks.length) await db.insert(documentChunks).values(chunks.map((content, ord) => ({ documentId, orgId, cloneId: doc.cloneId, ord, content })));
  return chunks.length;
}
