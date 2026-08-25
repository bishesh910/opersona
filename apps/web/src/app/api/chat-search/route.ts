import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { getSessionCtx, getOrgCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Search the caller's own conversations by title or message content. */
export async function GET(req: NextRequest) {
  const s = await getSessionCtx();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ctx = await getOrgCtx(s);
  if (!ctx) return NextResponse.json({ error: 'no org' }, { status: 403 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });
  const pat = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const byTitle = db.select({ id: schema.conversations.id }).from(schema.conversations)
    .where(and(eq(schema.conversations.orgId, ctx.orgId), eq(schema.conversations.userId, s.userId), ilike(schema.conversations.title, pat)));
  const byContent = db.select({ id: schema.turns.conversationId }).from(schema.turns)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.turns.conversationId))
    .where(and(eq(schema.conversations.orgId, ctx.orgId), eq(schema.conversations.userId, s.userId), ilike(schema.turns.content, pat)));
  const ids = [...new Set([...(await byTitle), ...(await byContent)].map((r) => r.id))].filter((x): x is string => !!x).slice(0, 50);
  if (ids.length === 0) return NextResponse.json({ results: [] });
  const rows = await db.select({ slug: schema.conversations.slug, title: schema.conversations.title, at: schema.conversations.lastActivityAt })
    .from(schema.conversations).where(inArray(schema.conversations.id, ids))
    .orderBy(desc(schema.conversations.lastActivityAt)).limit(8);
  return NextResponse.json({ results: rows.map((r) => ({ slug: r.slug, title: r.title, when: r.at.toISOString().slice(0, 10) })) });
}
