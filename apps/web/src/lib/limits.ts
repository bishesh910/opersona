/**
 * Per-user sliding-window rate limits for expensive engine calls. In-memory —
 * good enough for one web process (this deploy); resets on restart, which only
 * ever errs friendly. Keyed by user id, so limits follow the person, not the IP.
 */

interface Rule { limit: number; windowMs: number; label: string }

const RULES = {
  messages: { limit: 30, windowMs: 10 * 60_000, label: 'up to 30 messages per 10 minutes' },
  selfie: { limit: 6, windowMs: 3_600_000, label: 'up to 6 selfie extractions per hour' },
  imports: { limit: 10, windowMs: 86_400_000, label: 'up to 10 history imports per day' },
  docs: { limit: 60, windowMs: 86_400_000, label: 'up to 60 document ingests per day' },
  ccUpload: { limit: 20, windowMs: 3_600_000, label: 'up to 20 transcript uploads per hour' },
  compose: { limit: 10, windowMs: 3_600_000, label: 'up to 10 story drafts per hour' },
  interview: { limit: 90, windowMs: 3_600_000, label: 'up to 90 interview answers per hour' },
  interviewChat: { limit: 300, windowMs: 3_600_000, label: 'up to 300 interview messages per hour' },
  scenarioGen: { limit: 4, windowMs: 3_600_000, label: 'up to 4 scenario batches per hour' },
  scenarioAnswer: { limit: 30, windowMs: 3_600_000, label: 'up to 30 scenario answers per hour' },
  scenarioCorrect: { limit: 20, windowMs: 3_600_000, label: 'up to 20 corrections per hour' },
  simulate: { limit: 20, windowMs: 3_600_000, label: 'up to 20 simulations per hour' },
} satisfies Record<string, Rule>;

const hits = new Map<string, number[]>();

function sweep(): void {
  if (hits.size < 10_000) return;
  const now = Date.now();
  for (const [k, arr] of hits) {
    const live = arr.filter((t) => now - t < 86_400_000);
    if (live.length === 0) hits.delete(k); else hits.set(k, live);
  }
}

export function rateLimit(key: string, rule: Rule): { ok: true } | { ok: false; retryAfterS: number; label: string } {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (arr.length >= rule.limit) {
    hits.set(key, arr);
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((arr[0]! + rule.windowMs - now) / 1000)), label: rule.label };
  }
  arr.push(now);
  hits.set(key, arr);
  sweep();
  return { ok: true };
}

/** Which limit (if any) applies to this engine-proxy call. */
export function engineLimitFor(method: string, path: string[]): { bucket: string; rule: Rule } | null {
  if (method !== 'POST') return null;
  if (path[0] === 'conversations' && path[2] === 'messages') return { bucket: 'messages', rule: RULES.messages };
  if (path[0] === 'avatar' && path[1] === 'from-selfie') return { bucket: 'selfie', rule: RULES.selfie };
  if (path[0] === 'imports' && path[2] === 'start') return { bucket: 'imports', rule: RULES.imports };
  if (path[0] === 'documents' && path[2] === 'ingest') return { bucket: 'docs', rule: RULES.docs };
  if (path[0] === 'clones' && path[2] === 'claude-code' && path[3] === 'upload') return { bucket: 'ccUpload', rule: RULES.ccUpload };
  if (path[0] === 'clones' && path[2] === 'compose-brief') return { bucket: 'compose', rule: RULES.compose };
  if (path[0] === 'clones' && path[2] === 'interview' && path[3] === 'chat') return { bucket: 'interviewChat', rule: RULES.interviewChat };
  if (path[0] === 'clones' && path[2] === 'interview' && (path[3] === 'answer' || path[3] === 'next')) return { bucket: 'interview', rule: RULES.interview };
  if (path[0] === 'clones' && path[2] === 'scenarios' && path.length === 3) return { bucket: 'scenarioGen', rule: RULES.scenarioGen };
  if (path[0] === 'clones' && path[2] === 'scenarios' && path[4] === 'answer') return { bucket: 'scenarioAnswer', rule: RULES.scenarioAnswer };
  if (path[0] === 'clones' && path[2] === 'scenarios' && path[4] === 'correct') return { bucket: 'scenarioCorrect', rule: RULES.scenarioCorrect };
  if (path[0] === 'clones' && path[2] === 'simulate') return { bucket: 'simulate', rule: RULES.simulate };
  return null;
}
