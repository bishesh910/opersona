import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

export interface CloneWorkspace { root: string; cwd: string; home: string; configDir: string; uploads: string }

/**
 * Per-clone on-disk layout. Everything here is DISPOSABLE — the persona lives in
 * Postgres. The SDK gets its own HOME/CLAUDE_CONFIG_DIR so host ~/.claude settings
 * and other clones' transcripts are never visible.
 *
 *   <dataDir>/orgs/<org>/clones/<clone>/{workspace,home,.claude}
 *   <dataDir>/orgs/<org>/uploads/<documentId>
 */
export function ensureWorkspace(orgId: string, cloneId: string): CloneWorkspace {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  const root = join(config.dataDir, 'orgs', safe(orgId), 'clones', safe(cloneId));
  const ws = { root, cwd: join(root, 'workspace'), home: join(root, 'home'), configDir: join(root, '.claude'), uploads: join(config.dataDir, 'orgs', safe(orgId), 'uploads') };
  for (const d of [ws.cwd, ws.home, ws.configDir, ws.uploads]) mkdirSync(d, { recursive: true, mode: 0o700 });
  return ws;
}

export function uploadPath(orgId: string, documentId: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return join(config.dataDir, 'orgs', safe(orgId), 'uploads', safe(documentId));
}
