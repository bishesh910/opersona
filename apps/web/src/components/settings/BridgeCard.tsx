'use client';
/**
 * "Your own subscription" — pair a machine running opersona-bridge so your
 * persona's engine work (interview extraction, learning jobs, imports) runs
 * there, on the user's own Claude plan — and the bridge learns from every
 * Claude Code / Codex session finished on that machine. Zero API key.
 */
import { useCallback, useEffect, useState } from 'react';
import { bridgeState, mintBridgeToken, revokeBridgeToken, type BridgeState } from '@/actions/bridge';
import { CopyButton } from '@/components/shell/CopyButton';
import { PairCommands } from '@/components/settings/PairCommands';

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function BridgeCard() {
  const [state, setState] = useState<BridgeState | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => { bridgeState().then(setState).catch(() => {}); }, []);
  useEffect(() => { reload(); const t = setInterval(reload, 10_000); return () => clearInterval(t); }, [reload]);

  async function mint() {
    setBusy(true);
    try {
      const { token } = await mintBridgeToken('my machine');
      setFresh(token);
      reload();
    } finally { setBusy(false); }
  }

  // ONE command does everything: pairs, installs as a background service (launchd /
  // systemd user unit), starts it, and reports whether it actually connected.
  const cmd = fresh ? `npx opersona@latest install --token ${fresh}` : '';
  const fgCmd = fresh ? `npx opersona@latest --token ${fresh}` : '';

  return (
    <section className="card space-y-3" data-bridge-card>
      <div>
        <h2 className="font-medium">
          Your machine, your subscription <span className="chip ml-2 border-green-400 text-green-700 dark:border-green-700 dark:text-green-400">no API key</span>
        </h2>
        <p className="muted mt-1 text-sm">
          Put the <span className="font-medium text-neutral-700 dark:text-neutral-300">opersona bridge</span> on any machine where Claude Code is signed in — one command.
          Your persona&rsquo;s learning then runs there, on the Claude plan you already pay for: interview extraction, imports,
          and every Claude Code / Codex session you finish is picked up automatically. Your Anthropic login never leaves that machine,
          and the web can never run code on it.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm" data-bridge-status>
        <span className={'inline-block h-2 w-2 rounded-full ' + (state?.connected ? 'bg-green-500' : 'bg-neutral-400')} />
        {state == null ? 'checking…' : state.connected ? <>bridge online — <span className="font-mono text-xs">{state.host}</span></> : 'no bridge connected'}
      </div>

      {fresh && (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="font-medium">Your bridge token — shown once. Copy it now.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-900" data-bridge-token>{fresh}</code>
            <CopyButton text={fresh} />
          </div>
          <PairCommands token={fresh} />
        </div>
      )}

      {(state?.tokens.length ?? 0) > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {state!.tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="muted shrink-0 text-xs">{t.lastSeenAt ? `seen ${ago(t.lastSeenAt)}` : 'never connected'}</span>
              <button type="button" className="btn-secondary btn-sm shrink-0 !px-2 !py-0.5 text-[11px]"
                onClick={() => { void revokeBridgeToken(t.id).then(reload); }}>revoke</button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn-secondary" onClick={mint} disabled={busy}>{busy ? 'Creating…' : 'Pair a machine'}</button>
    </section>
  );
}
