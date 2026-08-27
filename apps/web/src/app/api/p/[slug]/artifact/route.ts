/**
 * Public artifact download — the `.persona.json` file roundtrip (import it on
 * any opersona instance). Same visibility rules as the /p page.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCtx } from '@/lib/session';
import { getPublishedBySlug, canViewPublished } from '@/lib/community';
import { rateLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
  const rl = rateLimit(`artifact:${ip}`, { limit: 60, windowMs: 3_600_000, label: 'up to 60 downloads per hour' });
  if (!rl.ok) return NextResponse.json({ error: rl.label }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterS) } });
  const pub = await getPublishedBySlug(slug);
  const s = await getSessionCtx();
  if (!pub || !(await canViewPublished(pub, s ? { userId: s.userId, email: s.user.email } : null))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const fname = `${pub.artifact.persona.name}.persona.json`.replace(/[^A-Za-z0-9._-]/g, '_');
  return new NextResponse(JSON.stringify(pub.artifact, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${fname}"`,
      'cache-control': pub.visibility === 'public' ? 'public, max-age=300' : 'private, no-store',
    },
  });
}
