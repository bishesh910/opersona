'use client';
/**
 * One-click bridge pairing from the nav. The bridge is deliberately modest
 * since the MCP pivot: it runs the persona's BACKGROUND work on the user's
 * own Claude subscription — analysing history exports, extracting what the
 * interview learns, pixie-from-selfie, nightly tidy-ups. Nothing more.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { bridgeState, mintBridgeToken, type BridgeState } from '@/actions/bridge';
import { CopyButton } from '@/components/shell/CopyButton';

export function BridgeNavButton({ variant = 'sidebar', waiting = 0 }: { variant?: 'sidebar' | 'dot'; waiting?: number }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [state, setState] = useState<BridgeState | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [origin, setOrigin] = useState('https://opersona.me');
  useEffect(() => { if (window.location.origin.startsWith('http')) setOrigin(window.location.origin); }, []);
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
      {mounted && open && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50" role="dialog" aria-modal="true" aria-label="Pair your machine" onClick={() => setOpen(false)}>
          <div className="flex min-h-full items-start justify-center sm:items-center sm:p-4">
          <div className="card w-full space-y-3 p-4 max-sm:min-h-full max-sm:rounded-none max-sm:border-x-0 sm:my-6 sm:max-w-md sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">Your machine, your subscription</h2>
                <p className="muted mt-0.5 text-sm">
                  The bridge does your persona&rsquo;s background chores on the Claude plan you already pay for:
                  analysing history exports, extracting what the interview learns, drawing your pixie from a selfie,
                  nightly tidy-ups. Nothing more — and the web can never run code on your machine.
                </p>
                <p className="muted mt-1.5 text-xs">
                  When this machine sleeps or goes offline, learning simply <span className="font-medium">waits</span> —
                  nothing is lost, and it catches up on its own the moment the bridge reconnects.
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
            {waiting > 0 && !connected && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {waiting} interview answer{waiting === 1 ? '' : 's'} waiting for this machine — wake it and they process automatically.
              </p>
            )}

            {!connected && !fresh && (state?.tokens.length ?? 0) > 0 && (
              <div className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/60">
                <p className="font-medium text-neutral-700 dark:text-neutral-300">Get it running again — on the paired machine, run:</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-neutral-900">npx opersona@latest install</code>
                  <CopyButton text="npx opersona@latest install" />
                </div>
                <p className="muted">
                  Safe to re-run any time: it reuses the saved pairing, reinstalls + restarts the service, and reports whether
                  it actually connected. Still stuck? <code>cat ~/.opersona-bridge/bridge.log</code> on that machine says why.
                </p>
              </div>
            )}
            {!connected && !fresh && (state?.tokens.length ?? 0) === 0 && (
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

            <div className="muted border-t border-neutral-200 pt-2.5 text-[11px] dark:border-neutral-800">
              <p className="mb-1">Same terminal, more persona — the connector works in <span className="font-medium text-neutral-700 dark:text-neutral-300">Claude Code</span> too (then <code>/mcp</code> to sign in):</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800">{`claude mcp add --transport http opersona ${origin}/mcp`}</code>
                <CopyButton text={`claude mcp add --transport http opersona ${origin}/mcp`} />
              </div>
              <p className="mt-2 mb-1">Moving or retiring a machine? Uninstall the service there (your pairing stays; only one machine connects at a time — the newest wins):</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800">npx opersona uninstall</code>
                <CopyButton text="npx opersona uninstall" />
              </div>
              <p className="mt-1.5">Prefer an API key instead, or need to revoke a machine&rsquo;s token? <Link href="/settings" className="underline underline-offset-2" onClick={() => setOpen(false)}>Settings → Models</Link>.</p>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
