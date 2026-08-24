'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ImportJobRow } from '@/lib/imports';

const MAX_BYTES = 200 * 1024 * 1024;
const POLL_MS = 5000;

function StatusChip({ s }: { s: ImportJobRow['status'] }) {
  const cls = s === 'done' ? 'border-green-400' : s === 'failed' ? 'border-red-400' : s === 'running' ? 'border-amber-400' : '';
  return <span className={'chip ' + cls}>{s}</span>;
}

export function ImportPanel({ cloneId, initialJobs, readOnly }: { cloneId: string; initialJobs: ImportJobRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<ImportJobRow[]>(initialJobs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** When the user drops claude.ai's manifest-*.json, we show its conversation download links instead of importing it. */
  const [manifestLinks, setManifestLinks] = useState<{ filename: string; url: string }[] | null>(null);
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');

  useEffect(() => { setJobs(initialJobs); }, [initialJobs]);

  // Poll while anything is in flight; when the last job settles, refresh the page so the patterns above update.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/clones/${cloneId}/imports`, { cache: 'no-store' });
        if (!res.ok || stop) return;
        const j = (await res.json()) as { jobs: ImportJobRow[] };
        setJobs(j.jobs);
        if (!j.jobs.some((x) => x.status === 'queued' || x.status === 'running')) router.refresh();
      } catch { /* transient */ }
    };
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [active, cloneId, router]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { setMsg({ kind: 'err', text: 'File exceeds 200 MB' }); return; }
    setBusy(true); setMsg(null); setManifestLinks(null);
    // claude.ai's export gives a small manifest JSON whose links only work in your logged-in browser.
    if (file.size < 1_000_000 && /\.json$/i.test(file.name)) {
      try {
        const parsed = JSON.parse(await file.text()) as { data_files?: { category: string; filename: string; export_url: string }[] };
        if (parsed && Array.isArray(parsed.data_files)) {
          const links = parsed.data_files.filter((f) => f.category === 'conversations').map((f) => ({ filename: f.filename, url: f.export_url }));
          setBusy(false);
          if (!links.length) { setMsg({ kind: 'err', text: 'This manifest has no conversations file in it.' }); return; }
          setManifestLinks(links);
          return;
        }
      } catch { /* not a manifest — fall through and let the engine decide */ }
    }
    const fd = new FormData();
    fd.set('file', file);
    const res = await fetch(`/api/clones/${cloneId}/imports`, { method: 'POST', body: fd });
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ kind: 'err', text: j.error ?? `Upload failed (${res.status})` }); router.refresh(); return; }
    setMsg({ kind: 'ok', text: 'Uploaded. Processing in the background — this page updates as it goes.' });
    setJobs((prev) => [{ id: j.id!, filename: file.name, status: 'queued', total: 0, processed: 0, skipped: 0, observations: 0, error: null, createdAt: new Date().toISOString() }, ...prev]);
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="font-medium">Import your Claude or ChatGPT history</h2>
          <p className="muted text-sm">
            <strong>claude.ai</strong> → Settings → Privacy → Export data. When the email arrives, upload the <code>manifest-…json</code> here and click the download button it shows you (in the browser where you’re signed in to claude.ai — each link works once), then upload the zip you get.</p>
          <p className="muted text-sm">
            <strong>ChatGPT</strong>: chatgpt.com → Settings → Data controls → Export data — OpenAI emails you a zip; upload it here.</p>
          <p className="muted text-sm">
            Accepted: either export zip or its <code>conversations.json</code>. Processed in the background, newest first, up to 300 conversations; chats already learned from are skipped. Max 200 MB.
          </p>
        </div>
        {!readOnly && (
          <label className={'btn-primary cursor-pointer ' + (busy ? 'pointer-events-none opacity-50' : '')}>
            {busy ? 'Uploading…' : 'Upload export'}
            <input type="file" accept=".zip,.json,application/zip,application/json" className="hidden" onChange={upload} disabled={busy} />
          </label>
        )}
      </div>
      {msg && <p className={'text-sm ' + (msg.kind === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-600')}>{msg.text}</p>}
      {manifestLinks && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="font-medium">That file is the export index — your chats are behind these links.</p>
          <p className="muted mt-1 text-xs">Step 1: click to download (it opens in your browser, where you’re logged in to claude.ai — each link works once). Step 2: come back and <strong>Upload export</strong> with the zip you just downloaded.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {manifestLinks.map((l) => (
              <a key={l.url} className="btn-secondary btn-sm" href={l.url} target="_blank" rel="noreferrer">Download {l.filename}</a>
            ))}
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3 px-3 py-2" data-import={j.id} data-status={j.status}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{j.filename}</div>
                <div className="muted text-xs">
                  processed {j.processed} of {j.total} · skipped {j.skipped} · {j.observations} observations
                  {j.error && <span className="ml-2 text-red-600">{j.error}</span>}
                </div>
                <div className="muted text-xs" suppressHydrationWarning>{new Date(j.createdAt).toLocaleString()}</div>
              </div>
              <StatusChip s={j.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
