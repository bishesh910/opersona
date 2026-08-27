/**
 * Bridge-facing HTTP (Caddy proxies /bridge/* here; NO internal token — these
 * authenticate with the machine's own obr_ bridge token instead).
 */
import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { db, clones, personaBriefs } from '@opersona/db';
import { headPNG } from '@opersona/pixel-avatar';
import { DEFAULT_RECIPE } from '@opersona/shared';
import { authBridgeToken } from '../bridge/hub.js';
import { activePrompt } from '../persona/assemble.js';

export const bridgePublic = new Hono();

/** The owner's assembled persona system prompt — the desktop app feeds this to
 *  `claude --append-system-prompt` so local Claude Code thinks like the user.
 *  obr_-token authenticated; returns the OWNER audience (their own full persona). */
bridgePublic.get('/prompt', async (c) => {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const auth = await authBridgeToken(token);
  if (!auth) return c.json({ error: 'bad bridge token' }, 401);
  const [clone] = await db.select({ id: clones.id }).from(clones)
    .where(and(eq(clones.orgId, auth.orgId), eq(clones.ownerUserId, auth.userId), eq(clones.kind, 'member'), isNull(clones.archivedAt)))
    .limit(1);
  if (!clone) return c.json({ error: 'no persona yet — finish onboarding at opersona.me' }, 404);
  const { prompt, promptHash } = await activePrompt(auth.orgId, clone.id, 'owner');
  const [brief] = await db.select({ name: personaBriefs.displayName }).from(personaBriefs).where(eq(personaBriefs.cloneId, clone.id)).limit(1);
  return c.json({ cloneId: clone.id, name: brief?.name || null, prompt, promptHash });
});

/** The paired user's pixie HEAD as a PNG — the tray wears it as its icon. */
bridgePublic.get('/avatar', async (c) => {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const auth = await authBridgeToken(token);
  if (!auth) return c.json({ error: 'bad bridge token' }, 401);
  const [clone] = await db.select({ r: clones.avatarRecipe }).from(clones)
    .where(and(eq(clones.orgId, auth.orgId), eq(clones.ownerUserId, auth.userId), eq(clones.kind, 'member'), isNull(clones.archivedAt)))
    .limit(1);
  const scale = Math.min(8, Math.max(1, Number(c.req.query('s') ?? 4) || 4));
  const png = headPNG(clone?.r ?? DEFAULT_RECIPE, scale);
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' },
  });
});
