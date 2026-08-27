import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { authBridgeToken, register } from './bridge/hub.js';
import { ZodError } from 'zod';
import { config } from './config.js';
import { internalAuth } from './auth.js';
import { routes } from './routes/index.js';
import { ingest } from './routes/ingest.js';
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
import('./learning/merge.js').then((m) => m.startNightlyTidy());

const server = serve({ fetch: app.fetch, port: config.port, hostname: process.env.ENGINE_HOST ?? '127.0.0.1' }, (info) => {
  console.log(`[engine] listening on :${info.port} · data=${config.dataDir} · live sessions=${liveCount()}`);
});

// ── opersona bridge: authenticated WebSocket from user machines (Caddy proxies /bridge/ws) ──
const wss = new WebSocketServer({ noServer: true, maxPayload: 40_000_000 }); // transcripts up to ~30MB ride this socket
(server as HttpServer).on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://engine');
  if (url.pathname !== '/bridge/ws') { socket.destroy(); return; }
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  void authBridgeToken(token).then((auth) => {
    if (!auth) {
      console.warn('[bridge] REJECTED upgrade: token %s… (len %d, prefix-ok %s) from %s',
        token.slice(0, 12), token.length, String(token.startsWith('obr_')), req.socket.remoteAddress ?? '?');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    console.log('[bridge] accepted upgrade for org=%s', auth.orgId);
    wss.handleUpgrade(req, socket, head, (ws) => register(ws, auth));
  }).catch((e) => { console.error('[bridge] upgrade auth error', e); socket.destroy(); });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void shutdown().finally(() => { server.close(); process.exit(0); }); });
