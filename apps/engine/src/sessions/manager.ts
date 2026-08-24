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
import { query, type Options, type SDKMessage, type SDKUserMessage, type Query, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { and, eq } from 'drizzle-orm';
import { db, clones, conversations, turns, sessionCosts } from '@opersona/db';
import { redactSecrets, type EngineEvent } from '@opersona/shared';
import { config } from '../config.js';
import { orgModelConfig, authMode } from '../keys.js';
import { ensureWorkspace } from '../isolation/workspace.js';
import { activePrompt, PLAIN_CLAUDE_PROMPT } from '../persona/assemble.js';
import { createPersonaServer, PERSONA_SERVER, PERSONA_TOOLS } from '../persona/mcp.js';
import { publish } from './events.js';
import { requestApproval } from './approvals.js';

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
  done: Promise<void>;
}

const live = new Map<string, Live>();

export function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k.startsWith('CLAUDE_') || k.startsWith('ANTHROPIC_')) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** Subprocess env for a clone. api-key: isolated HOME/CLAUDE_CONFIG_DIR + org key.
 *  host-login (pilot): keep the host HOME/CLAUDE_CONFIG_DIR so the machine's Claude
 *  Code login is used; the per-clone cwd still isolates the workspace. */
export function sessionEnv(ws: { home: string; configDir: string }, apiKey: string | null): Record<string, string> {
  if (authMode === 'host-login' && !apiKey) {
    const e = cleanEnv({});
    if (process.env.CLAUDE_CONFIG_DIR) e.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
    return e;
  }
  return cleanEnv({ HOME: ws.home, CLAUDE_CONFIG_DIR: ws.configDir, ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}) });
}

export interface Attachment { name: string; mime: string; dataBase64: string }
type UserBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };

/** Images become image blocks; text-like files are inlined; PDFs are text-extracted. */
async function attachmentBlocks(atts: Attachment[]): Promise<UserBlock[]> {
  const out: UserBlock[] = [];
  for (const a of atts.slice(0, 8)) {
    const buf = Buffer.from(a.dataBase64, 'base64');
    if (/^image\/(jpeg|png|gif|webp)$/.test(a.mime)) { out.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: a.dataBase64 } }); continue; }
    let text: string;
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
  const text = args.text;
  const header = `[context] today: ${new Date().toISOString().slice(0, 10)}\n\n`;
  // Volatile context goes in the user turn, never the system prompt (prefix cache).
  const isFirst = s.textBuf === '' && s.toolUses.length === 0 && !s.sdkSessionId;
  const blocks: UserBlock[] = [...(args.attachments?.length ? await attachmentBlocks(args.attachments) : []), { type: 'text', text: (isFirst ? header : '') + text }];
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
  const cloneMode = conv.mode === 'clone';
  const visitor = conv.userId !== clone.ownerUserId; // anyone but the owner gets the shareable-only persona
  const { prompt, promptHash } = cloneMode ? await activePrompt(args.orgId, args.cloneId, visitor ? 'visitor' : 'owner') : { prompt: PLAIN_CLAUDE_PROMPT, promptHash: 'plain' };
  const ctx = { orgId: args.orgId, cloneId: args.cloneId, conversationId: args.conversationId, userId: args.userId, visitor: conv.userId !== clone.ownerUserId };
  const server = createPersonaServer(ctx);
  const abort = new AbortController();
  const input = new InputQueue();

  const canUseTool: Options['canUseTool'] = async (toolName, toolInput, opts) => {
    // Persona MCP tools and read-only built-ins are free; everything else needs the human.
    if (toolName.startsWith(`mcp__${PERSONA_SERVER}__`) || toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') return { behavior: 'allow', updatedInput: toolInput };
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
    cwd: ws.cwd,
    env: sessionEnv(ws, cfg.apiKey),
    settingSources: [],
    // Plain-Claude chats get no built-in tools and only search_documents from the persona server; clone mode gets the lot.
    tools: cloneMode ? ['Read', 'Glob', 'Grep'] : [],
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
  const s: Live = { conversationId: args.conversationId, orgId: args.orgId, userId: args.userId, cloneId: args.cloneId, input, q, abort, sdkSessionId: conv.sdkSessionId ?? undefined, promptHash, model: conv.model ?? cfg.chatModel, textBuf: '', toolUses: [], done: Promise.resolve() };
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
          let turnId: string | undefined;
          if (text || s.toolUses.length) {
            const [row] = await db.insert(turns).values({ conversationId: s.conversationId, orgId: s.orgId, role: 'assistant', content: redactSecrets(text), toolUses: s.toolUses }).returning({ id: turns.id });
            turnId = row?.id;
          }
          if (text) emit({ type: 'assistant_message', text, turn_id: turnId });
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
