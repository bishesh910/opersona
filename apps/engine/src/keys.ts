import { and, eq, gte, sql } from 'drizzle-orm';
import { db, orgSettings, sessionCosts } from '@opersona/db';
import { decryptSecret } from '@opersona/shared';
import { config } from './config.js';

export interface OrgModelConfig { apiKey: string; chatModel: string; extractModel: string; condenseModel: string; chatEffort: string; bossCloneId: string | null }

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
  if (!apiKey) throw new Error('no_api_key: add your Anthropic API key in Settings to start chatting');

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
  };
}
