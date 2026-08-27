/**
 * Chat-history exports (claude.ai or ChatGPT) → reasoning observations. Accepts the
 * export .zip or a bare conversations.json. Each conversation with real human reasoning
 * is run through the same extractor as in-app chats (sourceKind='import'). Processes
 * newest first, updates import_jobs progress as it goes, and is resumable (processed counter).
 */
import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { eq } from 'drizzle-orm';
import { db, importJobs, reasoningObservations } from '@opersona/db';
import { and, like, or } from 'drizzle-orm';
import { extractFromTranscript, type TranscriptTurn } from './extractReasoning.js';
import { recomputeFingerprint } from './fingerprint.js';
import { publishSnapshot } from '../persona/assemble.js';
import { uploadPath } from '../isolation/workspace.js';

// ─── claude.ai export shapes ────────────────────────────────────────────────
interface ExportMessage { uuid?: string; sender: 'human' | 'assistant'; text?: string; content?: { type: string; text?: string }[]; created_at?: string }
interface ExportConversation { uuid: string; name?: string; created_at?: string; updated_at?: string; chat_messages?: ExportMessage[] }

// ─── ChatGPT export shapes (conversations.json: array of tree-mapped conversations) ──
interface GptContent { content_type?: string; parts?: unknown[]; text?: string }
interface GptMessage { author?: { role?: string }; content?: GptContent; metadata?: Record<string, unknown> }
interface GptNode { message?: GptMessage | null; parent?: string | null; children?: string[] }
interface GptConversation { id?: string; conversation_id?: string; title?: string; create_time?: number; update_time?: number; mapping?: Record<string, GptNode | null>; current_node?: string | null }

/** One conversation from any supported export, normalised for the import pipeline. */
export interface ParsedConversation { provider: 'claude' | 'chatgpt'; id: string; createdAt?: string; updatedAt?: string; transcript: TranscriptTurn[] }

function isConversation(x: unknown): x is ExportConversation {
  return !!x && typeof x === 'object' && Array.isArray((x as { chat_messages?: unknown }).chat_messages);
}
function isGptConversation(x: unknown): x is GptConversation {
  const m = (x as { mapping?: unknown } | null)?.mapping;
  return !!x && typeof x === 'object' && !!m && typeof m === 'object' && !Array.isArray(m);
}

export function toTranscript(c: ExportConversation): TranscriptTurn[] {
  return (c.chat_messages ?? []).map((m) => ({
    role: m.sender === 'human' ? 'human' as const : 'assistant' as const,
    text: (m.text && m.text.trim()) || (m.content ?? []).filter((b) => b.type === 'text' && b.text).map((b) => b.text!).join('\n'),
  })).filter((t) => t.text.trim().length > 0);
}

/** ChatGPT stores each conversation as a branching tree; the ACTIVE branch is the walk
 *  from current_node up via parent to the root. system/tool/hidden messages are dropped;
 *  only string parts are kept ('text' and 'multimodal_text' content). */
export function chatgptToTranscript(c: GptConversation): TranscriptTurn[] {
  const mapping = c.mapping ?? {};
  let cur: string | null | undefined = c.current_node && mapping[c.current_node] ? c.current_node
    : Object.keys(mapping).find((k) => !(mapping[k]?.children?.length)); // no current_node → any leaf
  const chain: GptNode[] = [];
  const visited = new Set<string>();
  while (cur && mapping[cur] && !visited.has(cur)) { visited.add(cur); chain.push(mapping[cur]!); cur = mapping[cur]!.parent; }
  chain.reverse();
  const out: TranscriptTurn[] = [];
  for (const node of chain) {
    const m = node.message;
    if (!m) continue;
    const role = m.author?.role;
    if (role !== 'user' && role !== 'assistant') continue; // system/tool messages are not the conversation
    if (m.metadata?.is_visually_hidden_from_conversation) continue;
    const ct = m.content?.content_type ?? '';
    if (ct !== 'text' && ct !== 'multimodal_text') continue; // code/tool payloads are not prose turns
    const text = (m.content?.parts ?? []).filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join('\n').trim();
    if (!text) continue;
    const turnRole = role === 'user' ? 'human' as const : 'assistant' as const;
    const last = out[out.length - 1];
    if (last && last.role === turnRole) last.text += '\n' + text; else out.push({ role: turnRole, text });
  }
  return out;
}

const epochIso = (t?: number): string | undefined => (typeof t === 'number' && Number.isFinite(t) ? new Date(t * 1000).toISOString() : undefined);
function gptId(c: GptConversation): string {
  return c.conversation_id ?? c.id ?? createHash('sha256').update(`${c.title ?? ''}|${c.create_time ?? ''}`).digest('hex').slice(0, 32);
}

function normalise(x: unknown): ParsedConversation | null {
  // ChatGPT first: its conversations never have chat_messages, claude's never have mapping.
  if (isGptConversation(x)) return { provider: 'chatgpt', id: gptId(x), createdAt: epochIso(x.create_time), updatedAt: epochIso(x.update_time), transcript: chatgptToTranscript(x) };
  if (isConversation(x)) return { provider: 'claude', id: x.uuid, createdAt: x.created_at, updatedAt: x.updated_at, transcript: toTranscript(x) };
  return null;
}

/** Accepts every shape we know of:
 *  - claude.ai official export zip (conversations.json inside, any path) or a bare conversations.json (array)
 *  - ChatGPT data-export zip (conversations.json: array of mapping-tree conversations) or that file alone
 *  - Claude-Conversation-Exporter / Claude Chat Exporter: "all conversations" JSON (array), a single
 *    conversation JSON (object with chat_messages), or their bulk zip (one <name>.json per conversation)
 *  - the new claude.ai manifest-*.json → explicit error telling the user what to download */
export function parseExport(buf: Buffer, filename: string): ParsedConversation[] {
  const fromJson = (text: string, name: string): ParsedConversation[] => {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) return data.map(normalise).filter((c): c is ParsedConversation => c !== null);
    if (data && typeof data === 'object' && Array.isArray((data as { data_files?: unknown }).data_files)) {
      const parts = ((data as { data_files: { category: string; filename: string }[] }).data_files).filter((f) => f.category === 'conversations').map((f) => f.filename);
      throw new Error(`${name} is the export MANIFEST, not the conversations. Download ${parts.length ? parts.join(', ') : 'conversations-000.zip'} from it (in the browser where you are signed in to claude.ai) and upload that zip instead.`);
    }
    const one = normalise(data);
    return one ? [one] : [];
  };
  if (filename.toLowerCase().endsWith('.zip') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries().filter((e) => !e.isDirectory && /\.json$/i.test(e.entryName) && !/(^|\/)(export_summary|users?|projects|memories|message_feedback|model_comparisons|shared_conversations)\.json$/i.test(e.entryName));
    const main = entries.find((e) => /(^|\/)conversations\.json$/.test(e.entryName));
    const out: ParsedConversation[] = [];
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

const MAX_CONVERSATIONS = Number(process.env.IMPORT_MAX_CONVERSATIONS ?? 300);
const CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY ?? 4);

export async function runImport(importId: string): Promise<void> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, importId)).limit(1);
  if (!job || job.status === 'done' || job.status === 'failed') return;
  const set = (v: Partial<typeof importJobs.$inferInsert>) => db.update(importJobs).set({ ...v, updatedAt: new Date() }).where(eq(importJobs.id, importId));
  try {
    const convs = parseExport(readFileSync(uploadPath(job.orgId, `import-${importId}`)), job.filename)
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))
      .slice(0, MAX_CONVERSATIONS);
    await set({ status: 'running', total: convs.length });
    // Conversations already learned from (same export uploaded twice, or a re-export): skip, never double-count.
    const seen = new Set((await db.select({ ref: reasoningObservations.sourceRef }).from(reasoningObservations)
      .where(and(eq(reasoningObservations.cloneId, job.cloneId), or(like(reasoningObservations.sourceRef, 'claude:%'), like(reasoningObservations.sourceRef, 'chatgpt:%'))))).map((r) => r.ref));
    let processed = job.processed, skipped = job.skipped, observations = job.observations;
    // Resume point, then process CONCURRENCY conversations at a time (each is its own Claude process).
    let next = job.processed + job.skipped;
    const worker = async () => {
      while (next < convs.length) {
        const c = convs[next++]!;
        const sourceRef = `${c.provider}:${c.id}`;
        const humanChars = c.transcript.filter((t) => t.role === 'human').reduce((n, t) => n + t.text.length, 0);
        if (seen.has(sourceRef) || c.transcript.filter((t) => t.role === 'human').length < 2 || humanChars < 200) { skipped++; await set({ skipped }); continue; }
        try {
          const out = await extractFromTranscript({ orgId: job.orgId, cloneId: job.cloneId, transcript: c.transcript, sourceKind: 'import', sourceRef });
          observations += out.observations.length;
        } catch (e) { console.error('[import] conversation failed', sourceRef, e instanceof Error ? e.message : e); }
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
    const raw = e instanceof Error ? e.message : String(e);
    // Never leak server paths to the UI; ENOENT means the stored upload is gone.
    const friendly = /ENOENT/i.test(raw)
      ? 'the uploaded file is missing on the server — please upload it again'
      : raw.split(config.dataDir).join('…').replace(/\/home\/[\w./-]+/g, '…');
    await set({ status: 'failed', error: friendly });
  }
}
