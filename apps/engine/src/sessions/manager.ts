/**
 * SessionManager — owns one live Claude Agent SDK `query()` per open conversation.
 *
 * - Streaming input: user turns are pushed into an async iterable so a single
 *   subprocess serves the whole conversation (cache-friendly, no re-spawn per turn).
 * - Output: SDK messages are mapped to EngineEvents on the conversation bus,
 *   assistant turns are persisted (redacted), costs are logged per result.
 * - Idle reap: after config.idleMs with no traffic the input closes, the process
 *   exits, and `sdk_session_id` is kept so the next message resumes the transcript.
 * - Isolation: per-clone cwd/HOME/CLAUDE_CONFIG_DIR; host Claude Code env vars are
 *   stripped so the subprocess never thinks it is nested inside another session.
 */
import { resolve, isAbsolute } from 'node:path';
import { query, type Options, type SDKMessage, type SDKUserMessage, type Query, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { and, eq } from 'drizzle-orm';
import { db, clones, conversations, turns, sessionCosts } from '@opersona/db';
import { redactSecrets, type EngineEvent } from '@opersona/shared';
import { maybeTitleConversation } from '../learning/title.js';
import { config } from '../config.js';
import { orgModelConfig } from '../keys.js';
import { ensureWorkspace, conversationWorkdir } from '../isolation/workspace.js';
import { activePrompt, PLAIN_CLAUDE_PROMPT } from '../persona/assemble.js';
import { createPersonaServer, PERSONA_SERVER, PERSONA_TOOLS } from '../persona/mcp.js';
import { publish } from './events.js';
import { requestApproval } from './approvals.js';
import { EXEC_BUILTINS, WRITE_TOOLS, wrapBash, writeToolInWorkspace, scanDir, diffFiles, saveAttachmentsToWorkdir, type FileStat } from './sandbox.js';

/** Minimal push-based async iterable for SDKUserMessage. */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;
  push(m: SDKUserMessage) { if (this.closed) return; const w = this.waiters.shift(); if (w) w({ value: m, done: false }); else this.items.push(m); }
  close() { this.closed = true; for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

interface Live {
  conversationId: string; orgId: string; cloneId: string; userId: string;
  input: InputQueue; q: Query; abort: AbortController; idle?: NodeJS.Timeout;
  sdkSessionId?: string; promptHash: string; model: string; textBuf: string; toolUses: { id: string; name: string; input: unknown; ok?: boolean; preview?: string }[];
  workdir: string; filesBefore: Map<string, FileStat>;
  done: Promise<void>;
}

const live = new Map<string, Live>();

/** Appended to the starred persona's prompt: it runs the floor. */
const BOSS_ADDENDUM = `

## You are the OFFICE BOSS (the starred persona)
You run the floor. When the human brings work: decide who on the team fits it best
(list_team shows everyone and their roles), then delegate_task to that persona and
report their result back with attribution. When the team is busy or a skill is
missing, hire_persona a TEMPORARY specialist — define their job, strengths,
responsibilities and how they should think; they get a desk immediately. Archive
hires when the engagement ends (archive_persona); rehiring the same name brings
them back. Consults and delegations are on the record and visible to the people
involved. Distribute work; do not hoard it.`;

export function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k.startsWith('CLAUDE_') || k.startsWith('ANTHROPIC_')) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** Subprocess env for a clone: isolated HOME/CLAUDE_CONFIG_DIR + the workspace's own key. */
export function sessionEnv(ws: { home: string; configDir: string }, apiKey: string): Record<string, string> {
  return cleanEnv({ HOME: ws.home, CLAUDE_CONFIG_DIR: ws.configDir, ANTHROPIC_API_KEY: apiKey });
}

export interface Attachment { name: string; mime: string; dataBase64: string }
type UserBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };

/** Images become image blocks; text-like files are inlined; PDFs are text-extracted. */
const ZIP_TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|xml|html|htm|css|py|js|jsx|ts|tsx|sh|bash|zsh|sql|toml|ini|conf|cfg|env|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|diff|patch|gitignore|dockerfile|makefile)$/i;

/** Unpack a zip attachment in memory: file tree + text contents, hard-capped so a
 *  zip bomb costs nothing (no disk writes, entry/size/total budgets, binaries listed only). */
async function zipToText(name: string, buf: Buffer): Promise<string> {
  const AdmZip = (await import('adm-zip')).default;
  let entries;
  try { entries = new AdmZip(buf).getEntries(); } catch { return `<attachment name="${name}">\n[could not read this zip — corrupted or unsupported format]\n</attachment>`; }
  const files = entries.filter((e) => !e.isDirectory);
  const tree = files.map((e) => `  ${e.entryName} (${e.header.size} B)`).slice(0, 200).join('\n');
  const parts: string[] = [`Files (${files.length}):`, tree, ''];
  let budget = 180_000; let shown = 0; let skipped = 0;
  for (const e of files) {
    if (shown >= 40 || budget <= 0) { skipped++; continue; }
    const base = e.entryName.split('/').pop() ?? e.entryName;
    if (!(ZIP_TEXT_EXT.test(base) || /^(readme|license|changelog|makefile|dockerfile)$/i.test(base))) { skipped++; continue; }
    if (e.header.size > 2_000_000) { skipped++; continue; }
    let text: string;
    try { text = e.getData().toString('utf8'); } catch { skipped++; continue; }
    if (text.includes('\u0000')) { skipped++; continue; }
    const take = text.slice(0, Math.min(20_000, budget));
    budget -= take.length; shown++;
    parts.push(`--- ${e.entryName} ---`, take, '');
  }
  if (skipped > 0) parts.push(`[${skipped} file(s) not inlined — binary, oversized, or over budget; the tree above lists everything]`);
  return `<attachment name="${name.replace(/"/g, '')}" type="zip">\n${parts.join('\n')}\n</attachment>`;
}

async function attachmentBlocks(atts: Attachment[]): Promise<UserBlock[]> {
  const out: UserBlock[] = [];
  for (const a of atts.slice(0, 8)) {
    const buf = Buffer.from(a.dataBase64, 'base64');
    if (/^image\/(jpeg|png|gif|webp)$/.test(a.mime)) { out.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: a.dataBase64 } }); continue; }
    let text: string;
    if (/zip/.test(a.mime) || /\.zip$/i.test(a.name)) { out.push({ type: 'text', text: redactSecrets(await zipToText(a.name, buf)).slice(0, 200_000) }); continue; }
    if (a.mime === 'application/pdf') { const pdfParse = (await import('pdf-parse')).default; text = (await pdfParse(buf)).text; }
    else text = buf.toString('utf8');
    out.push({ type: 'text', text: `<attachment name="${a.name.replace(/"/g, '')}">\n${redactSecrets(text).slice(0, 200_000)}\n</attachment>` });
  }
  return out;
}

export async function sendMessage(args: { conversationId: string; orgId: string; userId: string; cloneId: string; text: string; attachments?: Attachment[] }): Promise<void> {
  let s = live.get(args.conversationId);
  if (!s) s = await start(args);
  touch(s);
  // Save attachments as real files in the workdir BEFORE snapshotting, so sandboxed code
  // can process them and they are not counted as this turn's generated outputs.
  let saved: string[] = [];
  if (args.attachments?.length) {
    saved = saveAttachmentsToWorkdir(s.workdir, args.attachments.map((a) => ({ name: a.name, buf: Buffer.from(a.dataBase64, 'base64') })));
  }
  s.filesBefore = scanDir(s.workdir);
  const text = args.text;
  const header = `[context] today: ${new Date().toISOString().slice(0, 10)}\n\n`;
  // Volatile context goes in the user turn, never the system prompt (prefix cache).
  const isFirst = s.textBuf === '' && s.toolUses.length === 0 && !s.sdkSessionId;
  const savedNote: UserBlock[] = saved.length
    ? [{ type: 'text', text: `[Attached file(s) saved to your working directory: ${saved.join(', ')}. Use Bash/Read to open or process them directly.]` }]
    : [];
  const blocks: UserBlock[] = [...(args.attachments?.length ? await attachmentBlocks(args.attachments) : []), ...savedNote, { type: 'text', text: (isFirst ? header : '') + text }];
  const only = blocks.length === 1 ? blocks[0]! : null;
  s.input.push({ type: 'user', message: { role: 'user', content: only && only.type === 'text' ? only.text : blocks }, parent_tool_use_id: null });
  await db.update(conversations).set({ status: 'live', lastActivityAt: new Date() }).where(eq(conversations.id, args.conversationId));
}

export async function endSession(conversationId: string): Promise<void> {
  const s = live.get(conversationId);
  if (!s) return;
  s.input.close();
  s.abort.abort();
  live.delete(conversationId);
  await db.update(conversations).set({ status: 'idle', lastActivityAt: new Date() }).where(eq(conversations.id, conversationId)).catch(() => {});
  // Learn from the conversation now that it is over (idempotent; extracted_at gate).
  const { enqueue } = await import('../learning/queue.js');
  enqueue({ kind: 'extract', orgId: s.orgId, cloneId: s.cloneId, conversationId });
}

function touch(s: Live) {
  if (s.idle) clearTimeout(s.idle);
  s.idle = setTimeout(() => { void endSession(s.conversationId); }, config.idleMs);
}

async function start(args: { conversationId: string; orgId: string; userId: string; cloneId: string }): Promise<Live> {
  const [clone] = await db.select().from(clones).where(and(eq(clones.id, args.cloneId), eq(clones.orgId, args.orgId))).limit(1);
  if (!clone) throw new Error('clone not found');
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, args.conversationId)).limit(1);
  if (!conv) throw new Error('conversation not found');

  const cfg = await orgModelConfig(args.orgId);
  const ws = ensureWorkspace(args.orgId, args.cloneId);
  const workdir = conversationWorkdir(args.orgId, args.cloneId, args.conversationId);
  if (conv.cwd !== workdir) await db.update(conversations).set({ cwd: workdir }).where(eq(conversations.id, args.conversationId));
  const cloneMode = conv.mode === 'clone';
  const visitor = conv.userId !== clone.ownerUserId; // anyone but the owner gets the shareable-only persona
  const isBoss = cloneMode && cfg.bossCloneId === args.cloneId;
  const audience = clone.kind === 'hired' ? 'hired' as const : visitor ? 'visitor' as const : 'owner' as const;
  let { prompt, promptHash } = cloneMode ? await activePrompt(args.orgId, args.cloneId, audience) : { prompt: PLAIN_CLAUDE_PROMPT, promptHash: 'plain' };
  if (isBoss) { prompt += BOSS_ADDENDUM; promptHash += '.boss'; }
  const ctx = { orgId: args.orgId, cloneId: args.cloneId, conversationId: args.conversationId, userId: args.userId, visitor: conv.userId !== clone.ownerUserId, isBoss };
  const server = createPersonaServer(ctx);
  const abort = new AbortController();
  const input = new InputQueue();

  const canUseTool: Options['canUseTool'] = async (toolName, toolInput, opts) => {
    const inp = toolInput as Record<string, unknown>;
    // Persona MCP tools are free; WebSearch runs server-side at Anthropic (WebFetch stays unavailable);
    // read-only built-ins are jailed to the conversation workdir.
    if (toolName.startsWith(`mcp__${PERSONA_SERVER}__`) || toolName === 'WebSearch') return { behavior: 'allow', updatedInput: toolInput };
    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
      return readToolInWorkspace(toolName, inp, workdir)
        ? { behavior: 'allow', updatedInput: toolInput }
        : { behavior: 'deny', message: 'outside this chat\'s workspace' };
    }
    // Making files: Write/Edit stay inside the workdir; no host path is reachable.
    if (WRITE_TOOLS.includes(toolName)) {
      return writeToolInWorkspace(toolName, inp, workdir)
        ? { behavior: 'allow', updatedInput: toolInput }
        : { behavior: 'deny', message: 'can only write inside this chat\'s workspace' };
    }
    // Running code: the command is rewritten to execute inside the sandbox (no network,
    // workdir-only filesystem), so it needs no human approval. If the sandbox is disabled,
    // fall through to the owner-approval path below.
    if (toolName === 'Bash' && config.sbxEnabled) {
      return { behavior: 'allow', updatedInput: wrapBash(inp, workdir) };
    }
    if (!cloneMode) return { behavior: 'deny', message: 'not available in this chat' };
    const r = await requestApproval({ ...ctx, kind: 'tool', tool: toolName, input: toolInput, signal: opts.signal });
    return r.behavior === 'allow' ? { behavior: 'allow', updatedInput: (r.updatedInput as Record<string, unknown> | undefined) ?? toolInput } : { behavior: 'deny', message: r.message ?? 'denied by owner' };
  };

  const onStop: HookCallback = async () => {
    await db.update(conversations).set({ lastActivityAt: new Date() }).where(eq(conversations.id, args.conversationId)).catch(() => {});
    return {};
  };

  const options: Options = {
    model: conv.model ?? cfg.chatModel,
    effort: (conv.effort ?? cfg.chatEffort) as Options['effort'],
    systemPrompt: prompt,
    cwd: workdir,
    env: sessionEnv(ws, cfg.apiKey),
    settingSources: [],
    // Both modes get the sandboxed exec toolset + WebSearch. Plain-Claude still only sees
    // search_documents from the persona server (other persona tools disallowed below).
    tools: [...(config.sbxEnabled ? EXEC_BUILTINS : ['Read', 'Glob', 'Grep']), 'WebSearch'],
    ...(cloneMode ? {} : { disallowedTools: PERSONA_TOOLS.filter((t) => t !== 'search_documents').map((t) => `mcp__${PERSONA_SERVER}__${t}`) }),
    mcpServers: { [PERSONA_SERVER]: server },
    canUseTool,
    permissionMode: 'default',
    includePartialMessages: true,
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsdPerSession,
    abortController: abort,
    hooks: { Stop: [{ hooks: [onStop] }] },
    persistSession: true,
    ...(conv.sdkSessionId ? { resume: conv.sdkSessionId } : {}),
    stderr: (d) => { if (process.env.ENGINE_DEBUG) console.error('[sdk]', d.trimEnd()); },
  };

  const q = query({ prompt: input, options });
  const s: Live = { conversationId: args.conversationId, orgId: args.orgId, userId: args.userId, cloneId: args.cloneId, input, q, abort, sdkSessionId: conv.sdkSessionId ?? undefined, promptHash, model: conv.model ?? cfg.chatModel, textBuf: '', toolUses: [], workdir, filesBefore: scanDir(workdir), done: Promise.resolve() };
  s.done = consume(s);
  live.set(args.conversationId, s);
  return s;
}

async function consume(s: Live): Promise<void> {
  const emit = (ev: EngineEvent) => publish(s.conversationId, ev);
  try {
    for await (const m of s.q as AsyncIterable<SDKMessage>) {
      switch (m.type) {
        case 'system':
          if (m.subtype === 'init') {
            s.sdkSessionId = m.session_id;
            await db.update(conversations).set({ sdkSessionId: m.session_id }).where(eq(conversations.id, s.conversationId));
            emit({ type: 'session', session_id: m.session_id });
          } else if (m.subtype === 'api_retry') {
            emit({ type: 'status', message: `API error${m.error_status ? ` ${m.error_status}` : ''} (${String(m.error)}) — retrying in ${Math.round(m.retry_delay_ms / 1000)}s`, attempt: m.attempt, max: m.max_retries });
          }
          break;
        case 'stream_event': {
          const ev = m.event as { type: string; delta?: { type?: string; text?: string } };
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) { s.textBuf += ev.delta.text; emit({ type: 'text_delta', text: ev.delta.text }); }
          break;
        }
        case 'assistant': {
          for (const block of m.message.content) {
            if (block.type === 'tool_use') { s.toolUses.push({ id: block.id, name: block.name, input: block.input }); emit({ type: 'tool_use', id: block.id, name: block.name, input: block.input }); }
          }
          break;
        }
        case 'user': {
          const content = m.message.content;
          if (Array.isArray(content)) for (const block of content) {
            if (typeof block === 'object' && block && 'type' in block && block.type === 'tool_result') {
              const tr = block as { tool_use_id: string; content?: unknown; is_error?: boolean };
              const preview = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content ?? '');
              const tu = s.toolUses.find((t) => t.id === tr.tool_use_id); if (tu) { tu.ok = !tr.is_error; tu.preview = preview.slice(0, 400); }
              emit({ type: 'tool_result', id: tr.tool_use_id, ok: !tr.is_error, preview: preview.slice(0, 400) });
            }
          }
          break;
        }
        case 'result': {
          const ok = m.subtype === 'success';
          const text = s.textBuf.trim() || (ok ? m.result : '');
          // Any files the turn created/changed in the workdir become downloads.
          const files = diffFiles(s.workdir, s.filesBefore);
          s.filesBefore = scanDir(s.workdir);
          let turnId: string | undefined;
          if (text || s.toolUses.length || files.length) {
            const [row] = await db.insert(turns).values({ conversationId: s.conversationId, orgId: s.orgId, role: 'assistant', content: redactSecrets(text), toolUses: s.toolUses, files: files.length ? files : null }).returning({ id: turns.id });
            turnId = row?.id;
          }
          if (text) emit({ type: 'assistant_message', text, turn_id: turnId });
          if (files.length) emit({ type: 'files', files, turn_id: turnId });
          void maybeTitleConversation(s.orgId, s.cloneId, s.conversationId).catch((e) => console.error('[title]', e));
          const u = m.usage;
          const cost = m.total_cost_usd ?? null;
          await db.insert(sessionCosts).values({
            orgId: s.orgId, cloneId: s.cloneId, conversationId: s.conversationId, kind: 'chat', model: s.model, promptHash: s.promptHash,
            inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
            cacheReadInputTokens: u.cache_read_input_tokens ?? 0, cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
            costUsd: cost,
          }).catch((e) => console.error('[cost]', e));
          emit({ type: 'result', ok, cost_usd: cost, input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0, ...(ok ? {} : { error: ('errors' in m && Array.isArray(m.errors) ? m.errors.join('; ') : m.subtype) }) });
          s.textBuf = ''; s.toolUses = [];
          break;
        }
        default: break;
      }
    }
  } catch (e) {
    if (!s.abort.signal.aborted) { console.error('[session]', s.conversationId, e); emit({ type: 'error', message: e instanceof Error ? e.message : String(e) }); }
  } finally {
    if (live.get(s.conversationId) === s) live.delete(s.conversationId);
    await db.update(conversations).set({ status: 'idle', lastActivityAt: new Date() }).where(eq(conversations.id, s.conversationId)).catch(() => {});
  }
}

export function liveCount(): number { return live.size; }
export async function shutdown(): Promise<void> { for (const id of [...live.keys()]) await endSession(id); }


/** Workspace jail for the read-only built-ins: every path (and glob base) must resolve
 *  inside the per-clone workspace. Nothing under the host HOME, /etc, the repo, or the
 *  engine's own data dir is reachable from a chat — prompt injection included. */
export function readToolInWorkspace(tool: string, input: Record<string, unknown>, wsCwd: string): boolean {
  const root = resolve(wsCwd);
  const inside = (p: string) => {
    if (p.startsWith('~')) return false;
    const abs = resolve(root, p);
    return abs === root || abs.startsWith(root + '/');
  };
  const val = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  if (tool === 'Read') { const f = val('file_path'); return !!f && inside(f); }
  // Glob/Grep: optional base path defaults to cwd (= the workspace); patterns must stay relative.
  const base = val('path');
  if (base && !inside(base)) return false;
  const pattern = val('pattern');
  if (pattern && (isAbsolute(pattern) || pattern.startsWith('~') || pattern.includes('..'))) return false;
  return true;
}
