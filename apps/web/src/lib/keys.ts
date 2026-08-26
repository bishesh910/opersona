import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';

/**
 * Can this workspace run inference? True when it stores its own Anthropic key,
 * or when the install has a platform fallback key (self-hosts; opersona.me
 * deliberately sets none). Mirrors the engine's orgModelConfig() precedence.
 */
export async function orgHasChatKey(orgId: string): Promise<boolean> {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const [row] = await db.select({ k: schema.orgSettings.anthropicKeyEnc }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, orgId)).limit(1);
  return !!row?.k;
}
