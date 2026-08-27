/**
 * Build the environment for a spawned `claude` PTY. Two load-bearing rules from
 * the reference:
 *  1. Strip inherited CLAUDE(CODE|_)* vars — a Claude-launched wrapper otherwise
 *     leaks CLAUDE_CODE_CHILD_SESSION, which silently disables transcript
 *     writing and kills --resume. (Keep only the explicit login/config vars.)
 *  2. Set PATH + TERM + locale — a Dock-launched app inherits no locale, giving
 *     MacRoman mojibake in the xterm grid.
 */
const CLAUDE_KEEP = new Set([
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
]);

export function buildPtyEnv(base: NodeJS.ProcessEnv, pathEnv: string, extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (/^CLAUDE(CODE|_)/.test(k) && !CLAUDE_KEEP.has(k)) continue;
    // never let OUR own key leak into the child — it must use the user's login
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN' || k === 'CLAUDECODE') continue;
    env[k] = v;
  }
  env.PATH = pathEnv;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.FORCE_COLOR = '1';
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  if (!env.LC_CTYPE) env.LC_CTYPE = 'UTF-8';
  if (extra) for (const [k, v] of Object.entries(extra)) env[k] = v;
  return env;
}
