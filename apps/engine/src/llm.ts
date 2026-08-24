/**
 * One structured-output call, independent of auth mode.
 *  - host-login (pilot): goes through the Agent SDK (this machine's Claude Code login)
 *    with `outputFormat: json_schema`, no tools.
 *  - api-key: plain Messages API `parse()` with zodOutputFormat.
 * Cost is logged to session_costs either way.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { db, sessionCosts } from '@opersona/db';
import { ensureWorkspace } from './isolation/workspace.js';
import { sessionEnv } from './sessions/manager.js';

export interface StructuredCallArgs<S extends z.ZodTypeAny> {
  orgId: string; cloneId: string; kind: string;
  apiKey: string | null; model: string;
  system: string; user: string; schema: S;
  effort?: 'low' | 'medium' | 'high';
}

/** zod → JSON Schema the API (2020-12) and the CLI validator both accept: no `$schema`
 *  tag, and callers must avoid tuples (use length-bounded arrays). */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** One plain text completion, independent of auth mode (used by self-tests: persona answers a question). */
export async function textCall(a: { orgId: string; cloneId: string; kind: string; apiKey: string | null; model: string; system: string; user: string; effort?: 'low' | 'medium' | 'high' }): Promise<string> {
  if (a.apiKey) {
    const client = new Anthropic({ apiKey: a.apiKey });
    const res = await client.messages.create({ model: a.model, max_tokens: 4096, system: a.system, messages: [{ role: 'user', content: a.user }], ...(a.effort ? { output_config: { effort: a.effort } } : {}) });
    await db.insert(sessionCosts).values({ orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }).catch(() => {});
    return res.content.filter((b): b is Extract<typeof res.content[number], { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
  }
  const ws = ensureWorkspace(a.orgId, 'jobs');
  let out = ''; let err: string | undefined;
  for await (const m of query({ prompt: a.user, options: {
    model: a.model, systemPrompt: a.system, cwd: ws.cwd, env: sessionEnv(ws, null), settingSources: [], tools: [], maxTurns: 4, persistSession: false,
    ...(a.effort ? { effort: a.effort } : {}),
  } })) {
    if (m.type === 'result') {
      if (m.subtype !== 'success') err = m.subtype; else out = m.result;
      await db.insert(sessionCosts).values({ orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model, inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, costUsd: m.total_cost_usd }).catch(() => {});
    }
  }
  if (err) throw new Error(`text call failed: ${err}`);
  return out;
}

export async function structuredCall<S extends z.ZodTypeAny>(a: StructuredCallArgs<S>): Promise<z.infer<S>> {
  if (a.apiKey) {
    const client = new Anthropic({ apiKey: a.apiKey });
    const res = await client.messages.parse({
      model: a.model, max_tokens: 16000, system: a.system,
      messages: [{ role: 'user', content: a.user }],
      output_config: { format: zodOutputFormat(a.schema), ...(a.effort ? { effort: a.effort } : {}) },
    });
    await db.insert(sessionCosts).values({ orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0 }).catch(() => {});
    if (!res.parsed_output) throw new Error('no structured output');
    return res.parsed_output;
  }
  const ws = ensureWorkspace(a.orgId, 'jobs');
  let out: unknown; let err: string | undefined;
  for await (const m of query({ prompt: a.user, options: {
    model: a.model, systemPrompt: a.system, cwd: ws.cwd, env: sessionEnv(ws, null), settingSources: [], tools: [], maxTurns: 8, persistSession: false,
    ...(a.effort ? { effort: a.effort } : {}),
    outputFormat: { type: 'json_schema', schema: jsonSchemaOf(a.schema) },
  } })) {
    if (m.type === 'result') {
      if (m.subtype !== 'success') err = `${m.subtype}${'errors' in m && Array.isArray(m.errors) ? ': ' + m.errors.join('; ') : ''}`;
      else out = m.structured_output;
      await db.insert(sessionCosts).values({ orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model, inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, cacheReadInputTokens: m.usage.cache_read_input_tokens ?? 0, costUsd: m.total_cost_usd }).catch(() => {});
    }
  }
  if (err) throw new Error(`structured call failed: ${err}`);
  return a.schema.parse(out);
}
