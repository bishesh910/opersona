'use server';
/**
 * Reports on published personas — the one moderation input. Works logged-out
 * (public pages are public); rate-limited per session-or-IP. Platform admins
 * review at /admin/moderation and may delist/restore.
 */
import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getSessionCtx } from '@/lib/session';
import { getPublishedBySlug } from '@/lib/community';
import { rateLimit } from '@/lib/limits';

const REASONS = new Set(['impersonation', 'private-info', 'harmful', 'spam', 'other']);

export async function reportPersonaAction(slug: string, reason: string, details: string): Promise<{ ok: boolean; error?: string }> {
  const s = await getSessionCtx();
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
  const rl = rateLimit(`report:${s?.userId ?? ip}`, { limit: 5, windowMs: 86_400_000, label: 'up to 5 reports per day' });
  if (!rl.ok) return { ok: false, error: `Slow down — ${rl.label}.` };
  if (!REASONS.has(reason)) return { ok: false, error: 'pick a reason' };
  const pub = await getPublishedBySlug(slug);
  if (!pub || pub.status !== 'active') return { ok: false, error: 'persona not found' };
  const [dup] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.personaReports)
    .where(eq(schema.personaReports.publishedId, pub.id));
  if ((dup?.c ?? 0) >= 500) return { ok: false, error: 'this persona is already under review' };
  await db.insert(schema.personaReports).values({
    publishedId: pub.id, reporterUserId: s?.userId ?? null, reason, details: details.trim().slice(0, 2000) || null,
  });
  return { ok: true };
}

// ─── moderation (platform admins only) ──────────────────────────────────────

async function requireStaff() {
  const s = await getSessionCtx();
  const { isPlatformAdmin } = await import('@/lib/auth');
  if (!s || !isPlatformAdmin(s.user.email)) throw new Error('staff only');
  return s;
}

export async function resolveReportAction(reportId: string, action: 'delist' | 'restore' | 'dismiss'): Promise<void> {
  const s = await requireStaff();
  const [rep] = await db.select().from(schema.personaReports).where(eq(schema.personaReports.id, reportId)).limit(1);
  if (!rep) throw new Error('report not found');
  if (action === 'delist' || action === 'restore') {
    await db.update(schema.publishedPersonas)
      .set({ status: action === 'delist' ? 'delisted' : 'active', updatedAt: new Date() })
      .where(eq(schema.publishedPersonas.id, rep.publishedId));
  }
  await db.update(schema.personaReports)
    .set({ resolvedAt: new Date(), resolution: `${action} by ${s.user.email}` })
    .where(eq(schema.personaReports.id, reportId));
}
