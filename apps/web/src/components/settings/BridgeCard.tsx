'use client';
/**
 * "Your own subscription" — pair a machine running opersona-bridge so chats on
 * this account execute there, on the user's own Claude plan. Zero API key.
 */
import { useCallback, useEffect, useState } from 'react';
import { bridgeState, mintBridgeToken, revokeBridgeToken, type BridgeState } from '@/actions/bridge';
import { sealState, enableSealAction } from '@/actions/seal';
import { generateSealKeyB64, sealKeyFingerprint, storeSealKey, loadSealKey } from '@/lib/seal-client';
import { CopyButton } from '@/components/shell/CopyButton';

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
  const [sealForLink, setSealForLink] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const reload = useCallback(() => { bridgeState().then(setState).catch(() => {}); }, []);
  useEffect(() => { reload(); const t = setInterval(reload, 10_000); return () => clearInterval(t); }, [reload]);

  async function mint() {
    setBusy(true);
    try {
      const { token } = await mintBridgeToken('my machine');
      // Sealed conversations are the default: the FIRST pairing generates the key
      // in this browser; it reaches the bridge only inside the pairing command
      // below (--seal-key) — it is never sent to the server.
      try {
        const st = await sealState();
        if (!st.fp) {
          const key = generateSealKeyB64();
          const fp = await sealKeyFingerprint(key);
          const r = await enableSealAction(fp);
          if (r.ok) { storeSealKey(fp, key); setSealForLink(key); setRecovery(key); }
        } else {
          const key = loadSealKey(st.fp);
          setSealForLink(key); // null = this device lacks the key; the command pairs without it
        }
      } catch { /* sealing is best-effort at pair time */ }
      setFresh(token);
      reload();
    } finally { setBusy(false); }
  }

  const cmd = fresh ? `npx opersona@latest --token ${fresh}${sealForLink ? ` --seal-key ${sealForLink}` : ''}` : '';

  return (
    <section className="card space-y-3" data-bridge-card>
      <div>
        <h2 className="font-medium">
          Chat on your own subscription <span className="chip ml-2 border-green-400 text-green-700 dark:border-green-700 dark:text-green-400">no API key</span>
        </h2>
        <p className="muted mt-1 text-sm">
          Put the <span className="font-medium text-neutral-700 dark:text-neutral-300">opersona bridge</span> on any machine where Claude Code is signed in — one command, no install.
          Your chats here then <em>think</em> on that machine, on the Claude plan you already pay for. Your Anthropic login never leaves it,
          and the web can never run code there — anything beyond reading its own scratch folder asks you first.
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
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Run this on any machine where Claude Code is signed in:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-neutral-900" data-bridge-cmd>{cmd}</code>
              <CopyButton text={cmd} />
            </div>
            <p className="muted text-xs">Needs Node and the <code>claude</code> CLI signed in. The status above flips to <span className="font-medium">● online</span> within seconds.</p>
          {recovery && (
            <div className="space-y-1.5 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 dark:border-emerald-800 dark:bg-emerald-950/40" data-seal-recovery>
              <p className="text-xs font-medium">🔑 Your conversations are now SEALED — save this key like a password.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-neutral-900">{recovery}</code>
                <CopyButton text={recovery} />
              </div>
              <p className="muted text-[11px]">Chats are encrypted with it before they are stored — we keep only ciphertext and can never read them. Lose the key on all your devices = chat history unreadable forever. Derived persona memory stays readable so recall and sharing keep working.</p>
            </div>
          )}
          </div>
          <div className="space-y-1.5 border-t border-amber-200 pt-2 dark:border-amber-900">
            <p className="muted text-xs">Any other machine with Node 20+ (terminal):</p>
            <div className="flex items-center gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] leading-snug dark:bg-neutral-900">{cmd}</pre>
              <CopyButton text={cmd} />
            </div>
          </div>
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
