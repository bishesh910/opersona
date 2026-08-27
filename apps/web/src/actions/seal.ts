'use server';
/**
 * Sealed conversations — server side. The server only ever receives the key
 * FINGERPRINT: enough to detect the wrong key on a new device, never enough
 * to read anything.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg, isOrgAdmin } from '@/lib/session';

export async function sealState(): Promise<{ fp: string | null; sealedAt: string | null }> {
  const ctx = await requireOrg();
  const [row] = await db.select({ fp: schema.orgSettings.sealKeyFp, at: schema.orgSettings.sealedAt }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  return { fp: row?.fp ?? null, sealedAt: row?.at?.toISOString() ?? null };
}

/** One-way: sealing can be enabled once (re-keying would strand old ciphertext). */
export async function enableSealAction(fp: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireOrg();
  if (!isOrgAdmin(ctx)) return { ok: false, error: 'admin only' };
  if (!/^[0-9a-f]{16}$/.test(fp)) return { ok: false, error: 'bad fingerprint' };
  const res = await db.execute(sql`
    insert into org_settings (org_id, seal_key_fp, sealed_at) values (${ctx.orgId}, ${fp}, now())
    on conflict (org_id) do update set seal_key_fp = ${fp}, sealed_at = now()
    where org_settings.seal_key_fp is null`);
  void res;
  const [row] = await db.select({ fp: schema.orgSettings.sealKeyFp }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  return row?.fp === fp ? { ok: true } : { ok: false, error: 'sealing is already enabled with a different key' };
}
