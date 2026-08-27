/**
 * PtyManager — spawns `claude` in a node-pty and streams it to the renderer.
 * One session per id; output goes to per-id channels (pty:data:<id> /
 * pty:exit:<id>). Session-identity guards stop a killed process from spraying
 * into a respawned session under the same id.
 */
import type { WebContents } from 'electron';
import * as pty from 'node-pty';
import { userShellPath, resolveCommand } from './shellEnv.js';
import { buildPtyEnv } from './ptyEnv.js';

export interface SpawnOpts {
  id: string;
  command?: string;            // defaults to 'claude'
  args: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

interface Session { id: string; proc: pty.IPty; owner: WebContents }

export class PtyManager {
  private sessions = new Map<string, Session>();

  spawn(opts: SpawnOpts, owner: WebContents): { ok: true; pid: number } | { ok: false; error: string } {
    const pathEnv = userShellPath();
    const bin = (opts.command || 'claude').trim();
    const exe = resolveCommand(bin, pathEnv);
    const env = buildPtyEnv(process.env, pathEnv, opts.env);
    let proc: pty.IPty;
    try {
      proc = pty.spawn(exe, opts.args, {
        name: 'xterm-256color',
        cols: opts.cols ?? 100,
        rows: opts.rows ?? 30,
        cwd: opts.cwd,
        env,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const session: Session = { id: opts.id, proc, owner };
    this.sessions.set(opts.id, session);

    proc.onData((data) => {
      if (this.sessions.get(opts.id) !== session) return;        // superseded
      if (owner.isDestroyed()) return;
      owner.send(`pty:data:${opts.id}`, data);
    });
    proc.onExit(({ exitCode }) => {
      if (this.sessions.get(opts.id) !== session) return;
      this.sessions.delete(opts.id);
      if (!owner.isDestroyed()) owner.send(`pty:exit:${opts.id}`, exitCode);
    });
    return { ok: true, pid: proc.pid };
  }

  write(id: string, data: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    try { s.proc.write(data); return true; } catch { return false; }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (s && cols > 0 && rows > 0) { try { s.proc.resize(cols, rows); } catch { /* dead */ } }
  }

  /** Force a fresh TUI frame (same-size resize) to catch output that predated
   *  the renderer subscription. */
  redraw(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    try { const c = s.proc.cols, r = s.proc.rows; s.proc.resize(Math.max(1, c - 1), r); s.proc.resize(c, r); } catch { /* dead */ }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    try { s.proc.kill(); } catch { /* already gone */ }
  }

  killAll(): void { for (const id of [...this.sessions.keys()]) this.kill(id); }
  has(id: string): boolean { return this.sessions.has(id); }
}
