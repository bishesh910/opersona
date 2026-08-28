import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.ENGINE_PORT ?? 4000),
  internalToken: process.env.ENGINE_INTERNAL_TOKEN ?? '',
  dataDir: resolve(process.env.ENGINE_DATA_DIR ?? '../../data'),
  platformApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Monthly USD cap applied to workspaces running on the platform key (self-host fallback). BYO-key workspaces set their own budget in Settings. */
  defaultMonthlyBudgetUsd: Number(process.env.ENGINE_DEFAULT_MONTHLY_BUDGET_USD ?? 20),
  version: '0.0.1',
};

if (!config.internalToken) console.warn('[engine] ENGINE_INTERNAL_TOKEN is empty — all internal requests will be rejected');
