import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { ZodError } from 'zod';
import { config } from './config.js';
import { internalAuth } from './auth.js';
import { routes } from './routes/index.js';
import { ingest } from './routes/ingest.js';
import { startLocalScan } from './learning/claudeCode.js';
import { shutdown, liveCount } from './sessions/manager.js';
import { resumePending } from './learning/queue.js';

const app = new Hono();
app.route('/ingest', ingest);   // token-authenticated, no internal token
app.use('*', internalAuth);
app.route('/', routes);
app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: 'invalid request', issues: err.issues }, 400);
  console.error('[engine]', err);
  return c.json({ error: err.message }, 500);
});

void resumePending().catch((e) => console.error('[learning] resume failed', e));
startLocalScan();
import('./learning/merge.js').then((m) => m.startNightlyTidy());

const server = serve({ fetch: app.fetch, port: config.port, hostname: process.env.ENGINE_HOST ?? '127.0.0.1' }, (info) => {
  console.log(`[engine] listening on :${info.port} · data=${config.dataDir} · live sessions=${liveCount()}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void shutdown().finally(() => { server.close(); process.exit(0); }); });
