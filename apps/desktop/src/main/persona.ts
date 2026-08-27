/**
 * Fetch the user's assembled persona system prompt from opersona.me, using the
 * bridge token already on this machine (~/.opersona-bridge/config.json). This is
 * the one wire between the site and the app: the site builds your persona, the
 * app runs Claude Code with it as --append-system-prompt.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface BridgeConfig { url?: string; token?: string }

export function readBridgeConfig(): BridgeConfig {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.opersona-bridge', 'config.json'), 'utf8')) as BridgeConfig;
  } catch {
    return {};
  }
}

export interface Persona { cloneId: string; name: string | null; prompt: string; promptHash: string }

/** Returns the persona, or an error string (no token, not onboarded, offline). */
export async function fetchPersona(): Promise<{ ok: true; persona: Persona } | { ok: false; error: string; needsPairing?: boolean }> {
  const cfg = readBridgeConfig();
  if (!cfg.token) return { ok: false, error: 'This machine is not paired yet. Open opersona.me → Settings → Claude access to pair it.', needsPairing: true };
  const base = (cfg.url || 'https://opersona.me').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/bridge/prompt`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) return { ok: false, error: 'Your pairing token was rejected — re-pair this machine at opersona.me.', needsPairing: true };
    if (res.status === 404) return { ok: false, error: 'No persona yet — build one at opersona.me first (it takes about two minutes).' };
    if (!res.ok) return { ok: false, error: `opersona.me returned ${res.status}` };
    const persona = (await res.json()) as Persona;
    if (!persona.prompt) return { ok: false, error: 'The persona came back empty — try again in a moment.' };
    return { ok: true, persona };
  } catch (e) {
    return { ok: false, error: `Could not reach opersona.me (${e instanceof Error ? e.message : 'offline'}).` };
  }
}

export function siteUrl(): string {
  return (readBridgeConfig().url || 'https://opersona.me').replace(/\/$/, '');
}
