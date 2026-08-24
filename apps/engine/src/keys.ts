import { eq } from 'drizzle-orm';
import { db, orgSettings } from '@opersona/db';
import { decryptSecret } from '@opersona/shared';
import { config } from './config.js';

export type AuthMode = 'api-key' | 'host-login';
/** `host-login` = PILOT ONLY: the SDK subprocess inherits this machine's Claude Code
 *  login (claude.ai subscription). Fine for one
 *  person on their own box; a multi-tenant deployment must use `api-key` (BYO key). */
export const authMode: AuthMode = (process.env.ENGINE_AUTH_MODE as AuthMode) === 'host-login' ? 'host-login' : 'api-key';

export interface OrgModelConfig { apiKey: string | null; chatModel: string; extractModel: string; condenseModel: string; chatEffort: string }

/** BYO key per org; platform key is only a fallback for the pilot. */
export async function orgModelConfig(orgId: string): Promise<OrgModelConfig> {
  const [row] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId)).limit(1);
  let apiKey = config.platformApiKey;
  if (row?.anthropicKeyEnc) {
    try { apiKey = decryptSecret(row.anthropicKeyEnc); } catch (e) { console.error('[keys] cannot decrypt org key', orgId, e); }
  }
  if (!apiKey && authMode !== 'host-login') throw new Error('No Anthropic API key configured for this org (Settings → API key)');
  return {
    apiKey: apiKey || null,
    chatModel: row?.chatModel ?? 'claude-opus-5',
    extractModel: row?.extractModel ?? 'claude-sonnet-5',
    condenseModel: row?.condenseModel ?? 'claude-haiku-4-5',
    chatEffort: row?.chatEffort ?? 'high',
  };
}
