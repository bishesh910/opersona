'use server';
/**
 * opersona bridge pairing: mint/revoke the obr_ tokens a user's machine uses
 * to connect. The raw token is shown exactly once; only its sha256 is stored.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, bridgeTokens } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { engineFetch } from '@/lib/engine';

export interface BridgeTokenRow { id: string; name: string; createdAt: string; lastSeenAt: string | null }
export interface BridgeState { connected: boolean; host?: string; since?: string; tokens: BridgeTokenRow[] }

export async function bridgeState(): Promise<BridgeState> {
  const ctx = await requireOrg();
  const rows = await db.select().from(bridgeTokens)
    .where(and(eq(bridgeTokens.orgId, ctx.orgId), isNull(bridgeTokens.revokedAt)))
    .orderBy(desc(bridgeTokens.createdAt));
  const status = await engineFetch<{ connected: boolean; host?: string; since?: string }>(`/bridge/status?orgId=${encodeURIComponent(ctx.orgId)}`).catch((): { connected: boolean; host?: string; since?: string } => ({ connected: false }));
  return {
    connected: status.connected, host: status.host, since: status.since,
    tokens: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt?.toISOString() ?? null })),
  };
}

export async function mintBridgeToken(name: string): Promise<{ token: string }> {
  const ctx = await requireOrg();
  const clean = name.trim().slice(0, 60) || 'my machine';
  const token = 'obr_' + randomBytes(24).toString('hex');
  await db.insert(bridgeTokens).values({ orgId: ctx.orgId, userId: ctx.userId, name: clean, tokenHash: createHash('sha256').update(token).digest('hex') });
  return { token };
}

export async function revokeBridgeToken(id: string): Promise<void> {
  const ctx = await requireOrg();
  await db.update(bridgeTokens).set({ revokedAt: new Date() })
    .where(and(eq(bridgeTokens.id, id), eq(bridgeTokens.orgId, ctx.orgId), eq(bridgeTokens.userId, ctx.userId)));
}
