'use client';
/**
 * Sealed conversations — status + key management. Full honesty model: raw chats
 * are stored as ciphertext under a key only the user holds; derived persona
 * memory stays server-readable (that's what powers recall/connector/sharing);
 * live messages transit server memory but are never persisted in plaintext.
 */
import { useEffect, useState } from 'react';
import { sealState } from '@/actions/seal';
import { loadSealKey, storeSealKey, sealKeyFingerprint } from '@/lib/seal-client';
import { CopyButton } from '@/components/shell/CopyButton';

export function SealCard() {
  const [st, setSt] = useState<{ fp: string | null; sealedAt: string | null } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [entry, setEntry] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void sealState().then((s) => { setSt(s); if (s.fp) setKey(loadSealKey(s.fp)); }); }, []);

  async function unlock() {
    if (!st?.fp) return;
    setErr(null);
    const k = entry.trim();
    try {
      if ((await sealKeyFingerprint(k)) !== st.fp) { setErr('That key does not match this workspace.'); return; }
      storeSealKey(st.fp, k); setKey(k); setEntry('');
    } catch { setErr('That does not look like a valid key.'); }
  }

  return (
    <section className="card space-y-3" data-seal-card>
      <div>
        <h2 className="font-medium">Sealed conversations {st?.fp && <span className="chip ml-2 border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">on</span>}</h2>
        <p className="muted mt-1 text-sm">
          Your chats are encrypted before storage with a key <span className="font-medium text-neutral-700 dark:text-neutral-300">only you hold</span> — the server keeps ciphertext and a fingerprint, nothing more.
          Full honesty: messages still pass through server memory live (that&apos;s how they reach your model), and the <em>derived</em> persona memory (facts, patterns) stays readable so recall and sharing work. Raw transcripts: sealed.
        </p>
      </div>
      {!st ? <p className="muted text-xs">checking…</p> : !st.fp ? (
        <p className="text-sm"><span className="chip">not sealed yet</span> <span className="muted">Sealing turns on automatically the first time you pair a machine (the key is created in your browser during pairing).</span></p>
      ) : key ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="muted">This device holds the key.</span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setReveal((v) => !v)}>{reveal ? 'hide key' : 'reveal key'}</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="muted text-xs">Give it to your bridge:</span>
            <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800">npx opersona@latest --seal-key …</code>
            <CopyButton text={`npx opersona@latest --seal-key ${key}`} />
          </div>
          {reveal && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800">{key}</code>
              <CopyButton text={key} />
            </div>
          )}
          <p className="muted text-[11px]">Sealed since {st.sealedAt ? new Date(st.sealedAt).toLocaleString() : '—'}. Losing the key on every device makes sealed history unreadable forever — save it like a password.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm">This device doesn&apos;t hold your key — paste it to read sealed chats here:</p>
          <div className="flex gap-2">
            <input className="input flex-1 font-mono text-xs" type="password" placeholder="your seal key" value={entry} onChange={(e) => setEntry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void unlock(); }} />
            <button type="button" className="btn-primary" disabled={!entry.trim()} onClick={() => void unlock()}>Unlock</button>
          </div>
          {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
        </div>
      )}
    </section>
  );
}
