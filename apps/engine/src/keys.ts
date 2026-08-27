import { and, eq, gte, sql } from 'drizzle-orm';
import { db, orgSettings, sessionCosts } from '@opersona/db';
import { decryptSecret } from '@opersona/shared';
import { config } from './config.js';

export interface OrgModelConfig { apiKey: string; chatModel: string; extractModel: string; condenseModel: string; chatEffort: string; bossCloneId: string | null; sealKeyFp: string | null }
export interface OrgSettingsOnly { chatModel: string; extractModel: string; condenseModel: string; chatEffort: string; bossCloneId: string | null; sealKeyFp: string | null }

/** Model defaults + boss star WITHOUT resolving a key — for bridge sessions,
 *  which run on the user's own subscription (no key, no cloud budget). */
export async function orgSettingsOnly(orgId: string): Promise<OrgSettingsOnly> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
  return {
    chatModel: row?.chatModel ?? 'claude-opus-5',
    extractModel: row?.extractModel ?? 'claude-sonnet-5',
    condenseModel: row?.condenseModel ?? 'claude-haiku-4-5',
    chatEffort: row?.chatEffort ?? 'high',
    bossCloneId: row?.bossCloneId ?? null,
    sealKeyFp: row?.sealKeyFp ?? null,
  };
}

/**
 * BYO Anthropic key per workspace — the single chokepoint every inference site
 * passes through. A platform key (ANTHROPIC_API_KEY) is a self-host fallback
 * only; opersona.me deliberately sets none, so nothing runs on the operator's
 * dime. The monthly budget guard lives here for the same reason: one gate, all
 * eleven inference sites covered.
 */
export async function orgModelConfig(orgId: string): Promise<OrgModelConfig> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
  let apiKey = '';
  if (row?.anthropicKeyEnc) {
    try { apiKey = decryptSecret(row.anthropicKeyEnc); } catch (e) { console.error('[keys] cannot decrypt org key', orgId, e); }
  }
  const usingPlatformKey = !apiKey && !!config.platformApiKey;
  if (usingPlatformKey) apiKey = config.platformApiKey;
  if (!apiKey) {
    // Bridge rail: the user's machine runs inference on their subscription.
    // apiKey stays '' — llm.ts dispatches such calls as bridge jobs; no cloud
    // budget applies (nothing is spent here).
    const { bridgeFor } = await import('./bridge/hub.js');
    if (bridgeFor(orgId)) {
      const [r2] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
      return {
        apiKey: '',
        chatModel: r2?.chatModel ?? 'claude-opus-5',
        extractModel: r2?.extractModel ?? 'claude-sonnet-5',
        condenseModel: r2?.condenseModel ?? 'claude-haiku-4-5',
        chatEffort: r2?.chatEffort ?? 'high',
        bossCloneId: r2?.bossCloneId ?? null,
        sealKeyFp: r2?.sealKeyFp ?? null,
      };
    }
    throw new Error('no_api_key: connect your Claude in Settings — run the opersona bridge (your subscription) or add an API key');
  }

  // Monthly spend cap: the workspace's own budget, or the platform default when
  // it is running on the operator's key (never applied to BYO keys unset).
  const budget = row?.monthlyBudgetUsd ?? (usingPlatformKey ? config.defaultMonthlyBudgetUsd : null);
  if (budget && budget > 0) {
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const [agg] = await db
      .select({ total: sql<number>`coalesce(sum(${sessionCosts.costUsd}), 0)` })
      .from(sessionCosts)
      .where(and(eq(sessionCosts.orgId, orgId), gte(sessionCosts.createdAt, monthStart)));
    if ((agg?.total ?? 0) >= budget) {
      throw new Error(`budget_exceeded: this workspace reached its $${budget}/month cap`);
    }
  }

  return {
    apiKey,
    chatModel: row?.chatModel ?? 'claude-opus-5',
    extractModel: row?.extractModel ?? 'claude-sonnet-5',
    condenseModel: row?.condenseModel ?? 'claude-haiku-4-5',
    chatEffort: row?.chatEffort ?? 'high',
    bossCloneId: row?.bossCloneId ?? null,
    sealKeyFp: row?.sealKeyFp ?? null,
  };
}
