/**
 * Direct Messages-API calls (text + structured) on the workspace's own key.
 * Cost is priced locally (pricing.ts) and logged to session_costs.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db, sessionCosts } from '@opersona/db';
import { costOf } from './pricing.js';

export interface StructuredCallArgs<S extends z.ZodTypeAny> {
  orgId: string; cloneId: string; kind: string;
  apiKey: string; model: string;
  system: string; user: string; schema: S;
  effort?: 'low' | 'medium' | 'high';
}

/** One plain text completion (used by self-tests: persona answers a question). */
export async function textCall(a: { orgId: string; cloneId: string; kind: string; apiKey: string; model: string; system: string; user: string; effort?: 'low' | 'medium' | 'high' }): Promise<string> {
  const client = new Anthropic({ apiKey: a.apiKey });
  const res = await client.messages.create({ model: a.model, max_tokens: 4096, system: a.system, messages: [{ role: 'user', content: a.user }], ...(a.effort ? { output_config: { effort: a.effort } } : {}) });
  await db.insert(sessionCosts).values({ orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costUsd: costOf(a.model, res.usage) }).catch(() => {});
  return res.content.filter((b): b is Extract<typeof res.content[number], { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
}

export async function structuredCall<S extends z.ZodTypeAny>(a: StructuredCallArgs<S>): Promise<z.infer<S>> {
  const client = new Anthropic({ apiKey: a.apiKey });
  const res = await client.messages.parse({
    model: a.model, max_tokens: 16000, system: a.system,
    messages: [{ role: 'user', content: a.user }],
    output_config: { format: zodOutputFormat(a.schema), ...(a.effort ? { effort: a.effort } : {}) },
  });
  await db.insert(sessionCosts).values({ orgId: a.orgId, cloneId: a.cloneId, kind: a.kind, model: a.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0, costUsd: costOf(a.model, res.usage) }).catch(() => {});
  if (!res.parsed_output) throw new Error('no structured output');
  return res.parsed_output;
}
