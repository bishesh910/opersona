/** Write-only Anthropic API key for the org: encrypted at rest with SECRETS_KEK (AES-256-GCM). */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { encryptSecret } from '@/lib/crypto';
import { getSessionCtx, getOrgCtx, isOrgAdmin } from '@/lib/session';
import { engineFetch } from '@/lib/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ apiKey: z.string().trim().min(20).max(500).regex(/^sk-ant-/, 'Anthropic keys start with sk-ant-') });

async function guard() {
  const s = await getSessionCtx();
  if (!s) return { err: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  const ctx = await getOrgCtx(s);
  if (!ctx) return { err: NextResponse.json({ error: 'no organization' }, { status: 403 }) };
  if (!isOrgAdmin(ctx)) return { err: NextResponse.json({ error: 'org owner/admin only' }, { status: 403 }) };
  return { ctx };
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (g.err) return g.err;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid key' }, { status: 400 });
  // Validate with the engine first: a bad key otherwise hangs chats in the SDK's multi-minute 401 retry loop.
  try {
    const v = await engineFetch<{ ok: boolean; model?: string; status?: number; error?: string }>('/keys/validate', { body: { apiKey: parsed.data.apiKey } });
    if (!v.ok) return NextResponse.json({ error: `Key rejected by Anthropic${v.status ? ` (${v.status})` : ''}: ${v.error ?? 'unknown error'}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: `Could not validate key (engine unreachable: ${e instanceof Error ? e.message : String(e)}). Key not saved.` }, { status: 502 });
  }
  let enc: string;
  try { enc = encryptSecret(parsed.data.apiKey); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'encryption failed' }, { status: 500 }); }
  await db.insert(schema.orgSettings).values({ orgId: g.ctx.orgId, anthropicKeyEnc: enc })
    .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { anthropicKeyEnc: enc, updatedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

/** Remove the org key → engine falls back to the platform key. */
export async function DELETE() {
  const g = await guard();
  if (g.err) return g.err;
  await db.update(schema.orgSettings).set({ anthropicKeyEnc: null, updatedAt: new Date() }).where(eq(schema.orgSettings.orgId, g.ctx.orgId));
  return NextResponse.json({ ok: true });
}
