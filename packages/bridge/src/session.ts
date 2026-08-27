/**
 * One bridge chat session = one Claude Agent SDK query() on THIS machine,
 * under this machine's own Claude Code login. The engine streams user turns
 * in; we stream SDK messages out. Persona tools are stubs that RPC to the
 * cloud (that's where the memory lives); anything not explicitly allowed
 * asks the human through the normal opersona approval flow.
 *
 * Hard local rules, not negotiable from the cloud:
 *  - no Bash / Write / Edit — the web can never execute code on this machine
 *  - read-only built-ins are jailed to the per-conversation work directory
 *  - the session env never contains an API key (subscription is the point)
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { query, tool, createSdkMcpServer, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PERSONA_SERVER, PERSONA_TOOL_SPECS, sealEncrypt, type BridgeStart } from '@opersona/shared';

export interface SessionIO {
  sendEv: (m: SDKMessage) => void;
  sendEnd: (error?: string) => void;
  rpcTool: (name: string, args: unknown) => Promise<unknown>;
  rpcApproval: (toolName: string, input: unknown) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>;
}

class InputQueue implements AsyncIterable<SDKUserMessage> {
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

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

function insideWorkdir(toolName: string, input: Record<string, unknown>, root: string): boolean {
  const inside = (p: string) => { if (p.startsWith('~')) return false; const abs = resolve(root, p); return abs === root || abs.startsWith(root + '/'); };
  const val = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  if (toolName === 'Read') { const f = val('file_path'); return !!f && inside(f); }
  const base = val('path');
  if (base && !inside(base)) return false;
  const pattern = val('pattern');
  if (pattern && (isAbsolute(pattern) || pattern.startsWith('~') || pattern.includes('..'))) return false;
  return true;
}

/** Session env: this shell's environment minus any API key — Claude Code must
 *  use its own login. (CLAUDE_* stays: that IS the login.) */
function bridgeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'CLAUDECODE') continue;
    env[k] = v;
  }
  return env;
}

export class BridgeSession {
  readonly input = new InputQueue();
  private abort = new AbortController();
  private sawAnyMessage = false;
  private textBuf = '';

  constructor(private start: BridgeStart, private io: SessionIO, private sealKey?: string) {}

  push(m: SDKUserMessage): void { this.input.push(m); }
  cancel(): void { this.input.close(); this.abort.abort(); }

  async run(): Promise<void> {
    const workdir = join(homedir(), '.opersona-bridge', 'work', this.start.conversationId);
    mkdirSync(workdir, { recursive: true });
    try {
      await this.attempt(workdir, this.start.resume);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A resume id minted on another rail/machine is unknown here — retry fresh once.
      if (this.start.resume && !this.sawAnyMessage && !this.abort.signal.aborted) {
        try { await this.attempt(workdir, undefined); return; } catch (e2) {
          this.io.sendEnd(e2 instanceof Error ? e2.message : String(e2)); return;
        }
      }
      if (!this.abort.signal.aborted) { this.io.sendEnd(msg); return; }
    }
    this.io.sendEnd();
  }

  private async attempt(workdir: string, resume: string | undefined): Promise<void> {
    const stubs = this.start.tools
      .filter((name): name is keyof typeof PERSONA_TOOL_SPECS => name in PERSONA_TOOL_SPECS)
      .map((name) => {
        const spec = PERSONA_TOOL_SPECS[name];
        return tool(spec.name, spec.description, spec.shape, async (args: unknown) => {
          const r = await this.io.rpcTool(name, args);
          return r as { content: { type: 'text'; text: string }[] };
        });
      });

    const canUseTool: Options['canUseTool'] = async (toolName, toolInput) => {
      if (toolName.startsWith(`mcp__${PERSONA_SERVER}__`) || toolName === 'WebSearch') return { behavior: 'allow', updatedInput: toolInput };
      if (READ_TOOLS.has(toolName)) {
        return insideWorkdir(toolName, toolInput as Record<string, unknown>, workdir)
          ? { behavior: 'allow', updatedInput: toolInput }
          : { behavior: 'deny', message: "outside this chat's workspace" };
      }
      // Everything else — including any code execution — needs the owner's explicit
      // approval through the opersona web UI. Local machines are never driven silently.
      const r = await this.io.rpcApproval(toolName, toolInput);
      return r.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: (r.updatedInput as Record<string, unknown> | undefined) ?? toolInput }
        : { behavior: 'deny', message: r.message ?? 'denied by owner' };
    };

    const options: Options = {
      model: this.start.model,
      ...(this.start.effort ? { effort: this.start.effort as Options['effort'] } : {}),
      systemPrompt: this.start.systemPrompt,
      cwd: workdir,
      env: bridgeEnv(),
      settingSources: [],            // never mix this machine's CLAUDE.md into a persona chat
      tools: this.start.builtinTools as Options['tools'],
      mcpServers: stubs.length ? { [PERSONA_SERVER]: createSdkMcpServer({ name: PERSONA_SERVER, version: '0.0.1', tools: stubs }) } : {},
      canUseTool,
      permissionMode: 'default',
      includePartialMessages: true,
      maxTurns: this.start.maxTurns,
      abortController: this.abort,
      persistSession: true,
      ...(resume ? { resume } : {}),
    };

    const q = query({ prompt: this.input, options });
    for await (const m of q as AsyncIterable<SDKMessage>) {
      this.sawAnyMessage = true;
      // Sealed conversations: THIS machine holds the key, so the assistant turn is
      // encrypted here before storage — the server persists only the ciphertext it
      // receives on the result event (live deltas remain transit-only plaintext).
      if (this.sealKey) {
        if (m.type === 'stream_event') {
          const ev = (m as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) this.textBuf += ev.delta.text;
        }
        if (m.type === 'result') {
          const text = this.textBuf.trim() || ((m as { subtype?: string; result?: string }).subtype === 'success' ? ((m as { result?: string }).result ?? '') : '');
          const wrapped = { ...m, opersona_sealed: text ? sealEncrypt(this.sealKey, text) : '' };
          this.textBuf = '';
          this.io.sendEv(wrapped as unknown as SDKMessage);
          continue;
        }
      }
      this.io.sendEv(m);
    }
  }
}
