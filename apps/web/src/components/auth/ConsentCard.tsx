'use client';
import { useState } from 'react';

const KNOWN: Record<string, string> = {
  'claude.ai': 'Claude (claude.ai)',
  'claude.com': 'Claude',
};

/** Approve/deny an OAuth client. Posts the page's own (signed) query back to the consent endpoint. */
export function ConsentCard({ clientId, clientName, scope }: { clientId: string; clientName?: string; scope?: string }) {
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = clientName || KNOWN[clientId] || clientId;

  async function decide(accept: boolean) {
    setBusy(accept ? 'yes' : 'no'); setError(null);
    try {
      const res = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, oauth_query: window.location.search.replace(/^\?/, '') }),
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; redirect_uri?: string; error_description?: string; message?: string };
      const dest = j.url ?? j.redirect_uri;
      if (!res.ok || !dest) { setError(j.error_description ?? j.message ?? `Consent failed (${res.status})`); setBusy(null); return; }
      window.location.href = dest;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error'); setBusy(null);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h1 className="text-lg font-semibold"><span className="text-amber-600 dark:text-amber-500">{label}</span> wants to connect</h1>
        <p className="muted mt-1 text-sm">It will be able to, on your behalf:</p>
      </div>
      <ul className="space-y-1.5 text-sm">
        <li className="flex gap-2"><span aria-hidden>◆</span> load your persona (story, thinking patterns, confirmed memory)</li>
        <li className="flex gap-2"><span aria-hidden>◆</span> search your persona&apos;s memory</li>
        <li className="flex gap-2"><span aria-hidden>◆</span> save new insights as candidates you review later</li>
      </ul>
      <p className="muted text-xs">It can never read your private conversations on opersona, change your settings, or spend your API key. Revoke any time in Settings.</p>
      {scope && <p className="muted font-mono text-[11px]">scopes: {scope}</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!!busy} onClick={() => decide(true)}>{busy === 'yes' ? 'Connecting…' : 'Allow'}</button>
        <button type="button" className="btn-secondary flex-1" disabled={!!busy} onClick={() => decide(false)}>{busy === 'no' ? '…' : 'Deny'}</button>
      </div>
    </div>
  );
}
