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
import { join, resolve, isAbsolute, basename } from 'node:path';
import { query, tool, createSdkMcpServer, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { PERSONA_SERVER, PERSONA_TOOL_SPECS, sealEncrypt, type BridgeStart } from '@opersona/shared';
import { containedPath, pathArgsFor, type Workspace } from './workspace.js';

export interface SessionIO {
  sendEv: (m: SDKMessage) => void;
  sendEnd: (error?: string) => void;
  sendOpened: (mode: 'power' | 'sandbox', cwd?: string, reason?: string) => void;
  rpcTool: (name: string, args: unknown) => Promise<unknown>;
  rpcApproval: (toolName: string, input: unknown) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }>;
  /** called with every SDK session_id this session spawns, so the watcher can skip
   *  its own power-session transcripts (they land in the user's real repo dir). */
  noteSdkSession: (id: string) => void;
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
const POWER_BUILTINS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite']);
const MUTATING = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Only [A-Za-z0-9_-]; anything else (/, .., ~) is refused so the workdir can't escape. */
function safeSegment(id: string): boolean { return /^[A-Za-z0-9_-]{1,80}$/.test(id); }

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
  private powerMode = false;
  private root = '';

  constructor(private start: BridgeStart, private io: SessionIO, private workspaces: Workspace[], private sealKey?: string) {}

  push(m: SDKUserMessage): void { this.input.push(m); }
  cancel(): void { this.input.close(); this.abort.abort(); }

  async run(): Promise<void> {
    // POWER DECISION — made HERE, from local grants, never trusting the server's `power`.
    const askedCwd = this.start.power && this.start.cwd ? this.start.cwd : undefined;
    const grant = askedCwd ? this.workspaces.find((w) => {
      const c = containedPath(w.path, askedCwd);   // asked cwd must BE a granted root (or inside one)
      return c !== null;
    }) : undefined;
    // Only honor power if the asked cwd canonicalizes to inside an actual grant.
    const powerRoot = grant ? containedPath(grant.path, askedCwd!) : null;
    const power = !!powerRoot;
    const reason = this.start.power && !power ? 'that folder is not granted on this machine' : undefined;

    let workdir: string;
    if (power) {
      workdir = powerRoot!;
    } else {
      // sandbox: per-conversation scratch dir. Sanitize the id so it can't escape.
      const id = safeSegment(this.start.conversationId) ? this.start.conversationId : 'scratch';
      workdir = join(homedir(), '.opersona-bridge', 'work', id);
      mkdirSync(workdir, { recursive: true });
    }
    this.io.sendOpened(power ? 'power' : 'sandbox', power ? workdir : undefined, reason);
    this.powerMode = power;
    this.root = workdir;
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
      const input = (toolInput ?? {}) as Record<string, unknown>;
      // Persona tools (DB, RPC'd to the cloud) and server-side WebSearch are always fine.
      if (toolName.startsWith(`mcp__${PERSONA_SERVER}__`) || toolName === 'WebSearch') return { behavior: 'allow', updatedInput: toolInput };

      // File-jail: EVERY path arg must canonicalize inside this session's root. This runs
      // in BOTH modes (sandbox root = scratch dir, power root = the granted folder).
      const paths = pathArgsFor(toolName, input);
      const isFileTool = READ_TOOLS.has(toolName) || MUTATING.has(toolName) && toolName !== 'Bash';
      if (isFileTool) {
        if (!paths.length) return { behavior: 'deny', message: "can't verify the target path" };
        for (const p of paths) {
          if (containedPath(this.root, p.value) === null) {
            return { behavior: 'deny', message: `${p.value}: outside this chat's workspace (or a protected path)` };
          }
        }
        const pattern = typeof input.pattern === 'string' ? input.pattern : null;
        if (pattern && (isAbsolute(pattern) || pattern.startsWith('~') || pattern.includes('..'))) {
          return { behavior: 'deny', message: 'pattern must stay within the workspace' };
        }
      }

      // Read/Glob/Grep: allowed once the jail passes (no per-call human prompt).
      if (READ_TOOLS.has(toolName)) return { behavior: 'allow', updatedInput: toolInput };

      // Mutations (Bash/Write/Edit/…): only in POWER mode, and every one needs a live
      // human approval. In sandbox mode there is no code execution at all (fail closed).
      if (MUTATING.has(toolName) || toolName === 'TodoWrite') {
        if (!this.powerMode) return { behavior: 'deny', message: 'this chat is sandboxed — open it in a granted folder to run commands or edit files' };
        if (toolName === 'TodoWrite') return { behavior: 'allow', updatedInput: toolInput };  // no filesystem/network effect
        const r = await this.io.rpcApproval(toolName, toolInput);
        // SECURITY: run EXACTLY what was approved. A compromised server cannot swap the
        // approved `ls` for a `curl … | sh` via updatedInput — we ignore it for builtins.
        return r.behavior === 'allow' ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: r.message ?? 'denied by owner' };
      }

      // Any other/unknown builtin the SDK might surface: approval-gated in power, denied in sandbox.
      if (!this.powerMode) return { behavior: 'deny', message: 'not available in a sandboxed chat' };
      const r = await this.io.rpcApproval(toolName, toolInput);
      return r.behavior === 'allow' ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: r.message ?? 'denied by owner' };
    };

    const options: Options = {
      model: this.start.model,
      ...(this.start.effort ? { effort: this.start.effort as Options['effort'] } : {}),
      systemPrompt: this.start.systemPrompt,
      cwd: this.root || workdir,
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
      const anyM = m as { session_id?: string };
      if (anyM.session_id) this.io.noteSdkSession(anyM.session_id);
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
