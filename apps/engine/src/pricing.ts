/**
 * USD pricing per 1M tokens for the models opersona offers. Used to price
 * Messages-API calls (the Agent SDK reports its own total_cost_usd; plain
 * Messages calls do not). Approximate list prices — good enough for the
 * per-workspace monthly budget guard; update when Anthropic changes pricing.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

function priceFor(model: string | null | undefined): { in: number; out: number } {
  if (!model) return { in: 5, out: 25 };
  if (PRICES[model]) return PRICES[model];
  const fam = Object.keys(PRICES).find((k) => model.startsWith(k));
  if (fam) return PRICES[fam];
  if (model.includes('haiku')) return { in: 1, out: 5 };
  if (model.includes('sonnet')) return { in: 3, out: 15 };
  return { in: 5, out: 25 };
}

/** Cost in USD for one Messages-API call. Cache reads are billed at 0.1× input. */
export function costOf(model: string | null | undefined, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number {
  const p = priceFor(model);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1e6) * p.in
    + (cacheRead / 1e6) * p.in * 0.1
    + (cacheWrite / 1e6) * p.in * 1.25
    + (usage.output_tokens / 1e6) * p.out
  );
}
