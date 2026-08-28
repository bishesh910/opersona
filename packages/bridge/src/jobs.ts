/**
 * One-shot inference jobs (persona learning, titling, condensing) executed on
 * THIS machine's Claude subscription. No tools, no filesystem access, fresh
 * session each time, structured output via json_schema when asked.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { sealDecrypt, type BridgeJob } from '@opersona/shared';

function jobEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'CLAUDECODE') continue;
    env[k] = v;
  }
  return env;
}

export interface JobOutcome { ok: boolean; output?: unknown; text?: string; error?: string; usage?: { input: number; output: number; cacheRead?: number } }

let running = 0;
const waiters: (() => void)[] = [];
const MAX_CONCURRENT = 2;

async function slot(): Promise<void> {
  if (running < MAX_CONCURRENT) { running++; return; }
  await new Promise<void>((res) => waiters.push(res));
  running++;
}
function release(): void { running--; waiters.shift()?.(); }

function outcomeOf(m: Extract<SDKMessage, { type: 'result' }>, structured: boolean): JobOutcome {
  const usage = { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0, cacheRead: m.usage.cache_read_input_tokens ?? 0 };
  if (m.subtype !== 'success') return { ok: false, error: `${m.subtype}${'errors' in m && Array.isArray(m.errors) ? ': ' + m.errors.join('; ') : ''}`, usage };
  return structured ? { ok: true, output: m.structured_output, usage } : { ok: true, text: m.result, usage };
}

// ── warm job sessions ────────────────────────────────────────────────────────
// The expensive part of a job is BOOTING the Claude CLI (~3-15s), not the
// inference. Jobs that share a sessionKey (same model+system+schema — e.g.
// every interview reply) run as turns of ONE live streaming session: first
// turn pays the boot, the rest are just inference. Each turn's prompt is
// self-contained (the engine always sends full context), so accumulated
// session history is redundant but never wrong; sessions idle out after 5 min.
interface WarmSession { run(user: string): Promise<JobOutcome>; close(): void; lastUsed: number; dead: boolean }
const warmPool = new Map<string, WarmSession>();
const WARM_IDLE_MS = 5 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [k, w] of warmPool) if (w.dead || now - w.lastUsed > WARM_IDLE_MS) { w.close(); warmPool.delete(k); }
}, 60_000).unref();

function createWarmSession(job: BridgeJob): WarmSession {
  const structured = job.kind === 'structured';
  const cwd = join(homedir(), '.opersona-bridge', 'jobs');
  mkdirSync(cwd, { recursive: true });
  let feed: ((t: string | null) => void) | null = null;
  const backlog: (string | null)[] = [];
  const push = (t: string | null): void => { if (feed) { const f = feed; feed = null; f(t); } else backlog.push(t); };
  async function* prompts(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const t = backlog.length ? backlog.shift()! : await new Promise<string | null>((r) => (feed = r));
      if (t === null) return;
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: t }] } };
    }
  }
  const pending: ((o: JobOutcome) => void)[] = [];
  const self: WarmSession = {
    lastUsed: Date.now(),
    dead: false,
    run(user) { self.lastUsed = Date.now(); const p = new Promise<JobOutcome>((res) => pending.push(res)); push(user); return p; },
    close() { self.dead = true; push(null); },
  };
  const options: Options = {
    model: job.model,
    ...(job.effort ? { effort: job.effort as Options['effort'] } : {}),
    systemPrompt: job.system,
    cwd,
    env: jobEnv(),
    settingSources: [],
    tools: [],
    maxTurns: 400,
    persistSession: false,
    ...(structured && job.schema ? { outputFormat: { type: 'json_schema', schema: job.schema } } : {}),
  };
  void (async () => {
    try {
      for await (const m of query({ prompt: prompts(), options }) as AsyncIterable<SDKMessage>) {
        if (m.type === 'result') pending.shift()?.(outcomeOf(m, structured));
      }
    } catch (e) {
      const err: JobOutcome = { ok: false, error: e instanceof Error ? e.message : String(e) };
      while (pending.length) pending.shift()!(err);
    } finally {
      self.dead = true;
      const err: JobOutcome = { ok: false, error: 'warm job session ended' };
      while (pending.length) pending.shift()!(err);
    }
  })();
  return self;
}

export async function runJob(job: BridgeJob, sealKey?: string): Promise<JobOutcome> {
  // Warm path: reusable-keyed, no image, no sealed content (those stay one-shot).
  if (job.sessionKey && !job.image && !job.sealed?.length) {
    let w = warmPool.get(job.sessionKey);
    if (!w || w.dead) { w = createWarmSession(job); warmPool.set(job.sessionKey, w); }
    const out = await w.run(job.user);
    if (out.ok || !w.dead) return out;
    warmPool.delete(job.sessionKey); // the session died under us — pay one cold boot below
  }
  await slot();
  try {
    // Sealed substitution: the server ships ciphertext; only this machine can read it.
    let user = job.user;
    if (job.sealed?.length) {
      if (!sealKey) return { ok: false, error: 'sealed content but this bridge has no seal key — re-pair from Settings' };
      try {
        user = user.replace(/<<SEALED:(\d+)>> */g, (_, i) => sealDecrypt(sealKey, job.sealed![Number(i)] ?? ''));
      } catch (e) {
        return { ok: false, error: `could not unseal content: ${e instanceof Error ? e.message : e}` };
      }
    }
    const cwd = join(homedir(), '.opersona-bridge', 'jobs');
    mkdirSync(cwd, { recursive: true });
    const structured = job.kind === 'structured';
    const options: Options = {
      model: job.model,
      ...(job.effort ? { effort: job.effort as Options['effort'] } : {}),
      systemPrompt: job.system,
      cwd,
      env: jobEnv(),
      settingSources: [],
      tools: [],
      maxTurns: structured ? 8 : 4,
      persistSession: false,
      ...(structured && job.schema ? { outputFormat: { type: 'json_schema', schema: job.schema } } : {}),
    };
    let out: JobOutcome = { ok: false, error: 'no result' };
    let prompt: string | AsyncIterable<SDKUserMessage> = user;
    if (job.image) {
      const msg: SDKUserMessage = { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: job.image.mime as 'image/jpeg', data: job.image.base64 } },
        { type: 'text', text: user },
      ] } };
      prompt = (async function* once() { yield msg; })();
    }
    for await (const m of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
      if (m.type === 'result') {
        const usage = { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0, cacheRead: m.usage.cache_read_input_tokens ?? 0 };
        if (m.subtype !== 'success') {
          out = { ok: false, error: `${m.subtype}${'errors' in m && Array.isArray(m.errors) ? ': ' + m.errors.join('; ') : ''}`, usage };
        } else {
          out = structured ? { ok: true, output: m.structured_output, usage } : { ok: true, text: m.result, usage };
        }
      }
    }
    return out;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    release();
  }
}
