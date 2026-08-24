import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

/** Every route except /health requires the shared web↔engine bearer token. */
export const internalAuth: MiddlewareHandler = async (c, next) => {
  if (c.req.path === '/health' || c.req.path.startsWith('/ingest/')) return next();
  const h = c.req.header('authorization') ?? '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : (c.req.query('token') ?? '');
  const a = Buffer.from(tok), b = Buffer.from(config.internalToken);
  if (!config.internalToken || a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'unauthorized' }, 401);
  return next();
};
