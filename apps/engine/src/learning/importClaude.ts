/**
 * claude.ai data export → reasoning observations. Accepts the export .zip or a bare
 * conversations.json. Each conversation with real human reasoning is run through
 * the same extractor as in-app chats (sourceKind='import'). Processes newest first,
 * updates import_jobs progress as it goes, and is resumable (processed counter).
 */
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import { db, importJobs, reasoningObservations } from '@opersona/db';
import { and, like } from 'drizzle-orm';
import { extractFromTranscript, type TranscriptTurn } from './extractReasoning.js';
import { recomputeFingerprint } from './fingerprint.js';
import { publishSnapshot } from '../persona/assemble.js';
import { uploadPath } from '../isolation/workspace.js';

interface ExportMessage { uuid?: string; sender: 'human' | 'assistant'; text?: string; content?: { type: string; text?: string }[]; created_at?: string }
interface ExportConversation { uuid: string; name?: string; created_at?: string; updated_at?: string; chat_messages?: ExportMessage[] }

function isConversation(x: unknown): x is ExportConversation {
  return !!x && typeof x === 'object' && Array.isArray((x as { chat_messages?: unknown }).chat_messages);
}

/** Accepts every shape we know of:
 *  - official export zip (conversations.json inside, any path) or a bare conversations.json (array)
 *  - Claude-Conversation-Exporter / Claude Chat Exporter: "all conversations" JSON (array), a single
 *    conversation JSON (object with chat_messages), or their bulk zip (one <name>.json per conversation)
 *  - the new claude.ai manifest-*.json → explicit error telling the user what to download */
export function parseExport(buf: Buffer, filename: string): ExportConversation[] {
  const fromJson = (text: string, name: string): ExportConversation[] => {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) return data.filter(isConversation);
    if (isConversation(data)) return [data];
    if (data && typeof data === 'object' && Array.isArray((data as { data_files?: unknown }).data_files)) {
      const parts = ((data as { data_files: { category: string; filename: string }[] }).data_files).filter((f) => f.category === 'conversations').map((f) => f.filename);
      throw new Error(`${name} is the export MANIFEST, not the conversations. Download ${parts.length ? parts.join(', ') : 'conversations-000.zip'} from it (in the browser where you are signed in to claude.ai) and upload that zip instead.`);
    }
    return [];
  };
  if (filename.toLowerCase().endsWith('.zip') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries().filter((e) => !e.isDirectory && /\.json$/i.test(e.entryName) && !/(^|\/)(export_summary|users|projects|memories)\.json$/i.test(e.entryName));
    const main = entries.find((e) => /(^|\/)conversations\.json$/.test(e.entryName));
    const out: ExportConversation[] = [];
    for (const e of main ? [main] : entries) {
      try { out.push(...fromJson(e.getData().toString('utf8'), e.entryName)); } catch (err) { if (main) throw err; /* skip non-conversation json in bulk zips */ }
    }
    if (!out.length) throw new Error('No conversations found in the zip (expected conversations.json or one JSON per conversation)');
    return out;
  }
  const out = fromJson(buf.toString('utf8'), filename);
  if (!out.length) throw new Error('Expected a conversations array, a single conversation JSON, or the export zip');
  return out;
}

export function toTranscript(c: ExportConversation): TranscriptTurn[] {
  return (c.chat_messages ?? []).map((m) => ({
    role: m.sender === 'human' ? 'human' as const : 'assistant' as const,
    text: (m.text && m.text.trim()) || (m.content ?? []).filter((b) => b.type === 'text' && b.text).map((b) => b.text!).join('\n'),
  })).filter((t) => t.text.trim().length > 0);
}

const MAX_CONVERSATIONS = Number(process.env.IMPORT_MAX_CONVERSATIONS ?? 300);
const CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY ?? 4);

export async function runImport(importId: string): Promise<void> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, importId)).limit(1);
  if (!job || job.status === 'done' || job.status === 'failed') return;
  const set = (v: Partial<typeof importJobs.$inferInsert>) => db.update(importJobs).set({ ...v, updatedAt: new Date() }).where(eq(importJobs.id, importId));
  try {
    const convs = parseExport(readFileSync(uploadPath(job.orgId, `import-${importId}`)), job.filename)
      .sort((a, b) => (b.updated_at ?? b.created_at ?? '').localeCompare(a.updated_at ?? a.created_at ?? ''))
      .slice(0, MAX_CONVERSATIONS);
    await set({ status: 'running', total: convs.length });
    // Conversations already learned from (same export uploaded twice, or a re-export): skip, never double-count.
    const seen = new Set((await db.select({ ref: reasoningObservations.sourceRef }).from(reasoningObservations)
      .where(and(eq(reasoningObservations.cloneId, job.cloneId), like(reasoningObservations.sourceRef, 'claude:%')))).map((r) => r.ref));
    let processed = job.processed, skipped = job.skipped, observations = job.observations;
    // Resume point, then process CONCURRENCY conversations at a time (each is its own Claude process).
    let next = job.processed + job.skipped;
    const worker = async () => {
      while (next < convs.length) {
        const c = convs[next++]!;
        const transcript = toTranscript(c);
        const humanChars = transcript.filter((t) => t.role === 'human').reduce((n, t) => n + t.text.length, 0);
        if (seen.has(`claude:${c.uuid}`) || transcript.filter((t) => t.role === 'human').length < 2 || humanChars < 200) { skipped++; await set({ skipped }); continue; }
        try {
          const out = await extractFromTranscript({ orgId: job.orgId, cloneId: job.cloneId, transcript, sourceKind: 'import', sourceRef: `claude:${c.uuid}` });
          observations += out.observations.length;
        } catch (e) { console.error('[import] conversation failed', c.uuid, e instanceof Error ? e.message : e); }
        processed++;
        await set({ processed, observations });
        if (processed % 10 === 0) await recomputeFingerprint(job.orgId, job.cloneId).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, convs.length) }, worker));
    await recomputeFingerprint(job.orgId, job.cloneId);
    await publishSnapshot(job.orgId, job.cloneId);
    await set({ status: 'done' });
  } catch (e) {
    await set({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}
