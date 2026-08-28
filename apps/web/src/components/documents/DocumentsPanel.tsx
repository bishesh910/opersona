'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteDocumentAction } from '@/actions/documents';
import { ConfirmDialog } from '@/components/shell/Dialog';

export interface DocRow { id: string; filename: string; mime: string; bytes: number; createdAt: string; chunks: number }

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function DocumentsPanel({ cloneId, documents, readOnly }: { cloneId: string; documents: DocRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMsg({ kind: 'err', text: 'File exceeds 10MB' }); return; }
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set('file', file);
    const res = await fetch(`/api/clones/${cloneId}/documents`, { method: 'POST', body: fd });
    const j = (await res.json().catch(() => ({}))) as { chunks?: number; warning?: string; error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: j.error ?? `Upload failed (${res.status})` }); return; }
    setMsg(j.warning ? { kind: 'warn', text: j.warning } : { kind: 'ok', text: `Uploaded and ingested (${j.chunks ?? 0} chunks).` });
    router.refresh();
  }

  async function reingest(id: string) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/engine/documents/${id}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = (await res.json().catch(() => ({}))) as { chunks?: number; error?: string };
    setBusy(false);
    setMsg(res.ok ? { kind: 'ok', text: `Ingested (${j.chunks ?? 0} chunks).` } : { kind: 'err', text: j.error ?? `Ingest failed (${res.status})` });
    router.refresh();
  }

  function remove(id: string) {
    setConfirmingId(null);
    start(async () => {
      const r = await deleteDocumentAction(cloneId, id);
      setMsg(r.ok ? { kind: 'ok', text: 'Deleted.' } : { kind: 'err', text: r.error ?? 'Delete failed' });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {confirmingId && (
        <ConfirmDialog
          title="Delete this document?"
          message="The file and its searchable chunks are removed."
          busy={pending}
          onConfirm={() => remove(confirmingId)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Documents</h2>
          <p className="muted text-xs">Reference material your persona can search (txt, md, pdf; ≤10MB). Documents are treated as <em>untrusted data</em>: they never become facts about you without review.</p>
        </div>
        {!readOnly && (
          <label className={'btn-primary cursor-pointer ' + (busy ? 'pointer-events-none opacity-50' : '')}>
            {busy ? 'Working…' : 'Upload'}
            <input type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" className="hidden" onChange={upload} disabled={busy} />
          </label>
        )}
      </div>
      {msg && <p className={'text-sm ' + (msg.kind === 'ok' ? 'text-green-700 dark:text-green-400' : msg.kind === 'warn' ? 'text-amber-600' : 'text-red-600')}>{msg.text}</p>}
      {documents.length === 0 ? (
        <div className="card muted text-sm">No documents yet.</div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{d.filename}</div>
                <div className="muted text-xs" suppressHydrationWarning>{fmtBytes(d.bytes)} · {d.chunks} chunks · {new Date(d.createdAt).toLocaleString()}</div>
              </div>
              {!readOnly && (
                <div className="flex shrink-0 gap-1">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => reingest(d.id)} disabled={busy}>Re-ingest</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmingId(d.id)} disabled={pending}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
