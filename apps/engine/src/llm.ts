/**
 * One text / structured call, rail-aware at the single chokepoint every
 * learning site uses:
 *  - apiKey set  → direct Messages API on that key, priced locally.
 *  - apiKey ''   → the workspace's connected BRIDGE runs it as a one-shot SDK
 *    job on the user's own subscription (json_schema output for structured).
 * Cost logging: API calls carry costUsd; bridge jobs log tokens with costUsd
 * null so budgets never count subscription usage.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db, sessionCosts } from '@opersona/db';
import { costOf } from './pricing.js';
import { bridgeFor, runBridgeJob } from './bridge/hub.js';

export interface StructuredCallArgs<S extends z.ZodTypeAny> {
  orgId: string; cloneId: string; kind: string;
  apiKey: string; model: string;
  system: string; user: string; schema: S;
  effort?: 'low' | 'medium' | 'high';
}

/** zod → JSON Schema both the API (2020-12) and the CLI validator accept: no `$schema`
 *  tag, and callers must avoid tuples (use length-bounded arrays). */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function bridgeOrThrow(orgId: string) {
  const conn = bridgeFor(orgId);
  if (!conn) throw new Error('bridge_offline: this workspace has no API key and its bridge is not connected');
  return conn;
}

async function logCost(a: { orgId: string; cloneId: string; kind: string; model: string }, usage: { input: number; output: number; cacheRead?: number } | undefined, costUsd: number | null): Promise<void> {
  await db.insert(sessionCosts).values({
    orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model,
    inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0, cacheReadInputTokens: usage?.cacheRead ?? 0,
    costUsd,
  }).catch(() => {});
}

/** One plain text completion (used by titling, self-tests…). */
export async function textCall(a: { orgId: string; cloneId: string; kind: string; apiKey: string; model: string; system: string; user: string; effort?: 'low' | 'medium' | 'high' }): Promise<string> {
  if (!a.apiKey) {
    const r = await runBridgeJob(bridgeOrThrow(a.orgId), { kind: 'text', model: a.model, effort: a.effort, system: a.system, user: a.user });
    await logCost(a, r.usage, null);
    if (!r.ok || typeof r.text !== 'string') throw new Error(`text call failed on bridge: ${r.error ?? 'no output'}`);
    return r.text;
  }
  const client = new Anthropic({ apiKey: a.apiKey });
  const res = await client.messages.create({ model: a.model, max_tokens: 4096, system: a.system, messages: [{ role: 'user', content: a.user }], ...(a.effort ? { output_config: { effort: a.effort } } : {}) });
  await logCost(a, { input: res.usage.input_tokens, output: res.usage.output_tokens }, costOf(a.model, res.usage));
  return res.content.filter((b): b is Extract<typeof res.content[number], { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
}

export async function structuredCall<S extends z.ZodTypeAny>(a: StructuredCallArgs<S>): Promise<z.infer<S>> {
  if (!a.apiKey) {
    const r = await runBridgeJob(bridgeOrThrow(a.orgId), { kind: 'structured', model: a.model, effort: a.effort, system: a.system, user: a.user, schema: jsonSchemaOf(a.schema) });
    await logCost(a, r.usage, null);
    if (!r.ok) throw new Error(`structured call failed on bridge: ${r.error ?? 'no output'}`);
    return a.schema.parse(r.output);
  }
  const client = new Anthropic({ apiKey: a.apiKey });
  const res = await client.messages.parse({
    model: a.model, max_tokens: 16000, system: a.system,
    messages: [{ role: 'user', content: a.user }],
    output_config: { format: zodOutputFormat(a.schema), ...(a.effort ? { effort: a.effort } : {}) },
  });
  await logCost(a, { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0 }, costOf(a.model, res.usage));
  if (!res.parsed_output) throw new Error('no structured output');
  return res.parsed_output;
}
