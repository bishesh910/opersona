/**
 * The agent session — runs Claude Code LOCALLY via the Agent SDK (the user's own
 * subscription, not an API key), in the chosen folder, with the persona as the
 * system prompt. Streams typed events to the renderer, which paints a native
 * chat GUI (not a terminal). Mirrors the bridge's proven session logic.
 */
import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export type AgentEvent =
  | { t: 'session'; id: string }
  | { t: 'text'; text: string }                                  // assistant text delta
  | { t: 'tool'; id: string; name: string; input: unknown }
  | { t: 'tool_result'; id: string; ok: boolean; preview: string }
  | { t: 'approval'; id: string; name: string; input: unknown }  // needs a human yes/no
  | { t: 'result'; ok: boolean }
  | { t: 'status'; text: string }
  | { t: 'error'; message: string }
  | { t: 'end' };

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;
  push(m: SDKUserMessage) { if (this.closed) return; const w = this.waiters.shift(); if (w) w({ value: m, done: false }); else this.items.push(m); }
  close() { this.closed = true; for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return { next: () => {
      if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
      if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
      return new Promise((res) => this.waiters.push(res));
    } };
  }
}

export interface AgentOpts {
  cwd: string;
  systemPrompt: string;
  model?: string;
  emit: (e: AgentEvent) => void;
  /** Ask the renderer to approve a tool; resolves allow/deny. */
  requestApproval: (name: string, input: unknown) => Promise<boolean>;
  acceptEdits: () => boolean;   // live toggle from the UI
}

export class AgentSession {
  private input = new InputQueue();
  private abort = new AbortController();
  private started = false;

  constructor(private o: AgentOpts) {}

  send(text: string): void {
    this.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' } as unknown as SDKUserMessage);
    if (!this.started) { this.started = true; void this.run(); }
  }
  stop(): void { this.input.close(); this.abort.abort(); }

  private env(): Record<string, string> {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'CLAUDECODE') continue;
      if (/^CLAUDE_CODE_CHILD/.test(k)) continue;
      e[k] = v;
    }
    return e;
  }

  private async run(): Promise<void> {
    const canUseTool: Options['canUseTool'] = async (name, toolInput) => {
      if (READ_TOOLS.has(name) || name.startsWith('mcp__')) return { behavior: 'allow', updatedInput: toolInput };
      if (EDIT_TOOLS.has(name) && this.o.acceptEdits()) return { behavior: 'allow', updatedInput: toolInput };
      const ok = await this.o.requestApproval(name, toolInput);
      return ok ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: 'declined' };
    };
    const options: Options = {
      ...(this.o.model ? { model: this.o.model } : {}),
      systemPrompt: this.o.systemPrompt,
      cwd: this.o.cwd,
      env: this.env(),
      settingSources: [],
      canUseTool,
      permissionMode: 'default',
      includePartialMessages: true,
      maxTurns: 100,
      abortController: this.abort,
      persistSession: true,
    };
    try {
      const q = query({ prompt: this.input, options });
      for await (const m of q as AsyncIterable<SDKMessage>) {
        const anyM = m as Record<string, unknown>;
        switch (m.type) {
          case 'system':
            if ((m as { subtype?: string }).subtype === 'init') this.o.emit({ t: 'session', id: String(anyM.session_id ?? '') });
            else if ((m as { subtype?: string }).subtype === 'api_retry') this.o.emit({ t: 'status', text: 'API hiccup — retrying…' });
            break;
          case 'stream_event': {
            const ev = (m as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) this.o.emit({ t: 'text', text: ev.delta.text });
            break;
          }
          case 'assistant':
            for (const b of (m as { message: { content: { type: string; id?: string; name?: string; input?: unknown }[] } }).message.content)
              if (b.type === 'tool_use') this.o.emit({ t: 'tool', id: b.id ?? '', name: b.name ?? '', input: b.input });
            break;
          case 'user': {
            const content = (m as { message: { content: unknown } }).message.content;
            if (Array.isArray(content)) for (const b of content) {
              const bb = b as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
              if (bb.type === 'tool_result') {
                const prev = typeof bb.content === 'string' ? bb.content : JSON.stringify(bb.content ?? '');
                this.o.emit({ t: 'tool_result', id: bb.tool_use_id ?? '', ok: !bb.is_error, preview: prev.slice(0, 2000) });
              }
            }
            break;
          }
          case 'result':
            this.o.emit({ t: 'result', ok: (m as { subtype?: string }).subtype === 'success' });
            break;
        }
      }
    } catch (e) {
      if (!this.abort.signal.aborted) this.o.emit({ t: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    this.o.emit({ t: 'end' });
  }
}
