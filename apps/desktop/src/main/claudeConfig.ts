/**
 * First-run smoothing: pre-accept Claude Code's trust + permission dialogs for
 * a folder, so a Dock-launched app doesn't stall on a prompt the user can't see.
 * Conservative: we DON'T enable bypass mode — every tool still asks in the TUI,
 * which the user sees and answers in the terminal. (Reference: munder-difflin
 * config.ts ensureClaudePermissionsAccepted, minus the dangerous-mode flags.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function ensureClaudeTrust(cwd: string): void {
  try {
    const dotClaude = join(homedir(), '.claude.json');
    let cfg: Record<string, unknown> = {};
    if (existsSync(dotClaude)) {
      try { cfg = JSON.parse(readFileSync(dotClaude, 'utf8')) as Record<string, unknown>; } catch { cfg = {}; }
    }
    const projects = (cfg.projects && typeof cfg.projects === 'object' ? cfg.projects : {}) as Record<string, Record<string, unknown>>;
    projects[cwd] = { ...(projects[cwd] ?? {}), hasTrustDialogAccepted: true };
    cfg.projects = projects;
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
    writeFileSync(dotClaude, JSON.stringify(cfg, null, 2));
  } catch { /* best effort — worst case the user answers one trust prompt */ }
}
