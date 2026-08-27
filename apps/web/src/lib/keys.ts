import { and, eq, isNull } from 'drizzle-orm';
import { db, schema, bridgeTokens } from '@opersona/db';

/**
 * Can this workspace chat at all? True when it stores its own Anthropic key,
 * when a bridge machine is paired (their own subscription runs the session —
 * offline bridges surface a friendly bridge_offline error on send, not a gate),
 * or when the install has a platform fallback key (self-hosts; opersona.me
 * deliberately sets none). Mirrors the engine's rail order.
 */
export async function orgHasChatKey(orgId: string): Promise<boolean> {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const [row] = await db.select({ k: schema.orgSettings.anthropicKeyEnc }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId)).limit(1);
  if (row?.k) return true;
  const [paired] = await db.select({ id: bridgeTokens.id }).from(bridgeTokens).where(and(eq(bridgeTokens.orgId, orgId), isNull(bridgeTokens.revokedAt))).limit(1);
  return !!paired;
}
