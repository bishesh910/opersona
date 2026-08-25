import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.ENGINE_PORT ?? 4000),
  internalToken: process.env.ENGINE_INTERNAL_TOKEN ?? '',
  dataDir: resolve(process.env.ENGINE_DATA_DIR ?? '../../data'),
  platformApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Close an idle live session after this long. */
  idleMs: Number(process.env.ENGINE_IDLE_MS ?? 10 * 60_000),
  /** HITL approval wait before auto-deny. */
  approvalTimeoutMs: Number(process.env.ENGINE_APPROVAL_TIMEOUT_MS ?? 10 * 60_000),
  maxTurns: Number(process.env.ENGINE_MAX_TURNS ?? 40),
  maxBudgetUsdPerSession: Number(process.env.ENGINE_MAX_BUDGET_USD ?? 5),
  /** Sandboxed code execution in chats (bubblewrap). Off → Bash/Write/Edit fall back to owner approval. */
  sbxEnabled: process.env.OPERSONA_SBX_ENABLED !== 'false',
  sbxRunner: resolve(process.env.OPERSONA_SBX_RUNNER ?? '../../sbx/run.sh'),
  /** Default per-command wall-clock; the model may ask for less, capped at 600s in the runner. */
  sbxTimeoutMs: Number(process.env.OPERSONA_SBX_TIMEOUT_MS ?? 120_000),
  /** Largest single generated file offered as a download. */
  sbxMaxFileBytes: Number(process.env.OPERSONA_SBX_MAX_FILE_BYTES ?? 25 * 1024 * 1024),
  version: '0.0.1',
};

if (!config.internalToken) console.warn('[engine] ENGINE_INTERNAL_TOKEN is empty — all internal requests will be rejected');
