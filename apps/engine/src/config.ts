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
  version: '0.0.1',
};

if (!config.internalToken) console.warn('[engine] ENGINE_INTERNAL_TOKEN is empty — all internal requests will be rejected');
