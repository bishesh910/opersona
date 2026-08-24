import { and, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { headPNG } from '@opersona/pixel-avatar';
import { DEFAULT_RECIPE } from '@opersona/shared';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** The browser-tab icon is the logged-in user's own pixel persona (head crop); a default face when logged out. */
export async function GET() {
  let recipe = DEFAULT_RECIPE;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user) {
      const orgId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
      const where = orgId ? and(eq(schema.clones.ownerUserId, session.user.id), eq(schema.clones.orgId, orgId)) : eq(schema.clones.ownerUserId, session.user.id);
      const [clone] = await db.select({ r: schema.clones.avatarRecipe }).from(schema.clones).where(where).limit(1);
      if (clone?.r) recipe = clone.r;
    }
  } catch { /* fall back to the default face */ }
  return new Response(new Uint8Array(headPNG(recipe, 4)), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
}
