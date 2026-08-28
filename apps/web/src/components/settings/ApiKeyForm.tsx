'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/shell/Dialog';

export function ApiKeyForm({ hasKey, readOnly, onSaved }: { hasKey: boolean; readOnly: boolean; onSaved?: () => void }) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch('/api/settings/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? 'Failed' }); return; }
    setKey(''); setMsg({ ok: true, text: 'Key saved.' }); router.refresh(); onSaved?.();
  }

  async function remove() {
    setConfirming(false);
    setBusy(true); setMsg(null);
    const res = await fetch('/api/settings/key', { method: 'DELETE' });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: 'Key removed.' } : { ok: false, text: 'Failed' });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={'inline-block h-2 w-2 rounded-full ' + (hasKey ? 'bg-green-500' : 'bg-neutral-400')} />
        {hasKey ? 'A key is configured' : 'No key yet — chatting needs one'}
      </div>
      {!readOnly && (
        <div className="flex gap-2">
          <input className="input font-mono" type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} disabled={busy} />
          <button className="btn-primary" disabled={busy || key.trim().length < 20}>{hasKey ? 'Replace' : 'Save'}</button>
          {hasKey && <button type="button" className="btn-secondary" onClick={() => setConfirming(true)} disabled={busy}>Remove</button>}
        </div>
      )}
      {msg && <p className={'text-xs ' + (msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600')}>{msg.text}</p>}
      {confirming && (
        <ConfirmDialog
          title="Remove your API key?"
          message="Chats and learning pause until you add one again."
          confirmLabel="Remove key"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </form>
  );
}
