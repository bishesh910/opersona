'use client';
/**
 * One-click bridge pairing from the nav. The bridge is deliberately modest
 * since the MCP pivot: it runs the persona's BACKGROUND work on the user's
 * own Claude subscription — analysing history exports, extracting what the
 * interview learns, pixie-from-selfie, nightly tidy-ups. Nothing more.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { bridgeState, mintBridgeToken, type BridgeState } from '@/actions/bridge';
import { CopyButton } from '@/components/shell/CopyButton';

export function BridgeNavButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'dot' }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<BridgeState | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => { bridgeState().then(setState).catch(() => {}); }, []);

  // Slow ambient poll for the dot; fast poll while the panel waits for a pairing.
  useEffect(() => {
    reload();
    const t = setInterval(reload, open && !state?.connected ? 4000 : 20000);
    return () => clearInterval(t);
  }, [reload, open, state?.connected]);

  async function pair() {
    setBusy(true);
    try {
      const { token } = await mintBridgeToken('my machine');
      setFresh(token);
    } finally { setBusy(false); }
  }

  const connected = state?.connected === true;
  const dot = <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + (connected ? 'bg-green-500' : 'bg-neutral-400')} />;
  const cmd = fresh ? `npx opersona@latest install --token ${fresh}` : '';

  const trigger = variant === 'dot' ? (
    <button type="button" onClick={() => setOpen(true)} title={connected ? `bridge online — ${state?.host ?? ''}` : 'pair your machine'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60" data-bridge-nav>
      {dot}
    </button>
  ) : (
    <button type="button" onClick={() => setOpen(true)}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60" data-bridge-nav>
      {dot}
      <span>Bridge</span>
      <span className="muted ml-auto text-xs">{state == null ? '…' : connected ? 'online' : 'pair'}</span>
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Pair your machine" onClick={() => setOpen(false)}>
          <div className="card my-6 w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">Your machine, your subscription</h2>
                <p className="muted mt-0.5 text-sm">
                  The bridge does your persona&rsquo;s background chores on the Claude plan you already pay for:
                  analysing history exports, extracting what the interview learns, drawing your pixie from a selfie,
                  nightly tidy-ups. Nothing more — and the web can never run code on your machine.
                </p>
              </div>
              <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setOpen(false)}>Close</button>
            </div>

            <div className="flex items-center gap-2 text-sm">
              {dot}
              {state == null ? 'checking…' : connected
                ? <>online — <span className="font-mono text-xs">{state.host}</span></>
                : state.tokens.length > 0 ? 'paired, but not running right now' : 'no machine paired yet'}
            </div>

            {!connected && !fresh && (
              <button type="button" className="btn-primary btn-sm" onClick={() => void pair()} disabled={busy}>
                {busy ? 'Creating…' : 'Pair this machine'}
              </button>
            )}

            {!connected && fresh && (
              <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
                <p className="text-xs font-medium">Run this once on a machine where Claude Code is signed in — it&rsquo;s the whole setup:</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-neutral-900">{cmd}</code>
                  <CopyButton text={cmd} />
                </div>
                <p className="muted text-xs">
                  Pairs, installs itself as an invisible background service, and starts it. The dot up there turns
                  <span className="font-medium"> ● green</span> within seconds of it connecting. Needs Node and the <code>claude</code> CLI.
                </p>
              </div>
            )}

            <p className="muted border-t border-neutral-200 pt-2.5 text-[11px] dark:border-neutral-800">
              Prefer an API key instead, or need to revoke a machine? <Link href="/settings" className="underline underline-offset-2" onClick={() => setOpen(false)}>Settings → Models</Link>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
