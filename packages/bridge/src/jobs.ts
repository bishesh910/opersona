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

export async function runJob(job: BridgeJob, sealKey?: string): Promise<JobOutcome> {
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
