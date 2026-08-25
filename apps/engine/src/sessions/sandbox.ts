/**
 * Code execution for chats — the isolation layer.
 *
 * Chat Bash calls are rewritten (in canUseTool) to run through `sbx/run.sh`, which
 * runs the command in a namespace with no network and no host filesystem — only the
 * per-conversation workdir is writable. Because the command cannot reach anything
 * outside that folder, these tools run without a human approval prompt (every other
 * non-persona tool still requires one). Write/Edit are confined to the same workdir by
 * a path check. After each turn we diff the workdir and offer any new/changed file as a
 * download.
 */
import { readdirSync, statSync } from 'node:fs';
import { resolve, isAbsolute, relative, join } from 'node:path';
import { config } from '../config.js';

/** Tools we let a chat use to make things, all confined to the conversation workdir. */
export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
export const EXEC_BUILTINS = ['Read', 'Glob', 'Grep', 'Bash', ...WRITE_TOOLS];

/** Every path a Write/Edit touches must resolve inside the workdir. */
export function writeToolInWorkspace(tool: string, input: Record<string, unknown>, wsCwd: string): boolean {
  const root = resolve(wsCwd);
  const inside = (p: unknown) => {
    if (typeof p !== 'string' || p.startsWith('~')) return false;
    const abs = resolve(root, p);
    return abs === root || abs.startsWith(root + '/');
  };
  if (tool === 'NotebookEdit') return inside(input.notebook_path);
  return inside(input.file_path);
}

/** Rewrite a Bash tool call so the shell runs it inside the sandbox instead of on the host. */
export function wrapBash(input: Record<string, unknown>, wsCwd: string): Record<string, unknown> {
  const command = typeof input.command === 'string' ? input.command : '';
  const ms = typeof input.timeout === 'number' && input.timeout > 0 ? input.timeout : config.sbxTimeoutMs;
  const secs = Math.min(600, Math.max(1, Math.round(ms / 1000)));
  const b64 = Buffer.from(command, 'utf8').toString('base64');
  const wrapped = `OPERSONA_DATA_ROOT=${shq(config.dataDir)} ${shq(config.sbxRunner)} ${shq(resolve(wsCwd))} ${secs} ${b64}`;
  // Keep the model's own timeout off the outer shell — the runner enforces it inside.
  const { timeout: _omit, ...rest } = input;
  return { ...rest, command: wrapped };
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', '.npm', '.pnpm-store']);

export interface FileStat { size: number; mtimeMs: number }

/** Snapshot the workdir (path to size+mtime), skipping noise and capping the walk. */
export function scanDir(dir: string, cap = 4000): Map<string, FileStat> {
  const out = new Map<string, FileStat>();
  const root = resolve(dir);
  const walk = (d: string) => {
    if (out.size >= cap) return;
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.size >= cap) return;
      if (e.name.startsWith('.') && e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try { const st = statSync(full); out.set(relative(root, full), { size: st.size, mtimeMs: st.mtimeMs }); } catch { /* gone */ }
      }
    }
  };
  walk(root);
  return out;
}

/** Files that appeared or changed since `before` — newest first, sensible caps. */
export function diffFiles(dir: string, before: Map<string, FileStat>): { path: string; size: number }[] {
  const now = scanDir(dir);
  const changed: { path: string; size: number; mtimeMs: number }[] = [];
  for (const [p, st] of now) {
    const prev = before.get(p);
    if (!prev || prev.size !== st.size || prev.mtimeMs !== st.mtimeMs) {
      if (st.size > 0 && st.size <= config.sbxMaxFileBytes) changed.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return changed.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 40).map(({ path, size }) => ({ path, size }));
}

/** Resolve a download request to an absolute path, or null if it escapes the workdir. */
export function resolveInWorkdir(wsCwd: string, rel: string): string | null {
  if (typeof rel !== 'string' || !rel || rel.startsWith('~') || isAbsolute(rel)) return null;
  const root = resolve(wsCwd);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + '/')) return null;
  try { if (!statSync(abs).isFile()) return null; } catch { return null; }
  return abs;
}
