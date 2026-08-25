/**
 * Serving files a chat produced. The requested name is checked to be a real file that
 * lives directly inside this one conversation's own folder (see resolveInWorkdir); a
 * name that points anywhere else returns 404. Ownership is enforced upstream by the web
 * proxy before the request ever reaches here.
 */
import type { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, conversations } from '@opersona/db';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { resolveInWorkdir } from '../sessions/sandbox.js';
import { conversationWorkdir } from '../isolation/workspace.js';

export function registerDownloads(routes: Hono): void {
  routes.get('/conversations/:id/files', async (c) => {
    const id = c.req.param('id');
    const orgId = c.req.query('orgId') ?? '';
    const rel = c.req.query('path') ?? '';
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.orgId, orgId))).limit(1);
    if (!conv) return c.json({ error: 'conversation not found' }, 404);
    const workdir = conv.cwd ?? conversationWorkdir(conv.orgId, conv.cloneId, conv.id);
    const abs = resolveInWorkdir(workdir, rel);
    if (!abs) return c.json({ error: 'file not found' }, 404);
    const size = statSync(abs).size;
    const name = basename(abs).replace(/[^A-Za-z0-9._-]/g, '_') || 'download';
    const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
    return new Response(stream, { headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
    } });
  });
}
