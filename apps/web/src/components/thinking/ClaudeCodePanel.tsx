'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type IngestTokenRow = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
export type ClaudeCodeSessionRow = {
  sessionId: string; source: 'local' | 'hook' | 'upload'; project: string | null; humanTurns: number; observations: number;
  status: 'queued' | 'done' | 'skipped' | 'failed'; note: string | null; createdAt: string;
};
type UploadResult = { name: string; status: 'done' | 'skipped' | 'failed'; observations?: number; note?: string };

const BATCH = 10;
const MAX_FILES = 50;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

function StatusChip({ s }: { s: string }) {
  const cls = s === 'done' ? 'border-green-400' : s === 'failed' ? 'border-red-400' : s === 'queued' ? 'border-amber-400' : '';
  return <span className={'chip ' + cls}>{s}</span>;
}

/** The SessionEnd hook for ~/.claude/settings.json: posts the finished transcript to this host with the token. */
function backfillSnippet(host: string, token: string): string {
  return `for f in ~/.claude/projects/*/*.jsonl; do curl -sk -m 300 -X POST -H "Authorization: Bearer ${token}" --data-binary @"$f" ${host}/api/ingest/claude-code; echo; done`;
}

function hookSnippet(host: string, token: string): string {
  const command = `sh -c 'p=$(python3 -c "import sys,json;print(json.load(sys.stdin)[\\"transcript_path\\"])"); curl -sk -m 90 -X POST -H "Authorization: Bearer ${token}" --data-binary @"$p" ${host}/api/ingest/claude-code >/dev/null 2>&1 || true'`;
  return JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', timeout: 120, command }] }] } }, null, 2);
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked */ }
  }
  return <button type="button" className="btn-secondary btn-sm" onClick={copy}>{copied ? 'Copied' : label}</button>;
}

function shortProject(p: string | null): string {
  if (!p) return '—';
  // Claude Code names project dirs after the cwd with "/" turned into "-"; show the tail.
  const parts = p.split(/[-/]/).filter(Boolean);
  return parts.length > 3 ? '…' + parts.slice(-3).join('-') : p;
}

export function ClaudeCodePanel({ cloneId, initialTokens, initialSessions, readOnly }: {
  cloneId: string; initialTokens: IngestTokenRow[]; initialSessions: ClaudeCodeSessionRow[]; readOnly: boolean;
  /** Pilot-only: the host machine's own Claude Code folder — shown ONLY to the persona pinned as this server's local clone. */
}) {
  const router = useRouter();
  const base = `/api/engine/clones/${cloneId}/claude-code`;
  const [tokens, setTokens] = useState<IngestTokenRow[]>(initialTokens);
  const [sessions, setSessions] = useState<ClaudeCodeSessionRow[]>(initialSessions);
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [host, setHost] = useState('HOST');
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { setTokens(initialTokens); }, [initialTokens]);
  useEffect(() => { setSessions(initialSessions); }, [initialSessions]);
  useEffect(() => { setHost(window.location.origin); }, []);

  async function createToken() {
    setCreating(true); setMsg(null);
    try {
      const res = await fetch(`${base}/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Claude Code' }) });
      const j = (await res.json().catch(() => ({}))) as { id?: string; token?: string; error?: string };
      if (!res.ok || !j.id || !j.token) { setMsg({ kind: 'err', text: j.error ?? `Could not create token (${res.status})` }); return; }
      setFresh({ id: j.id, token: j.token });
      setTokens((prev) => [{ id: j.id!, name: 'Claude Code', createdAt: new Date().toISOString(), lastUsedAt: null }, ...prev]);
    } finally { setCreating(false); }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this token? Hooks using it will stop sending sessions.')) return;
    const res = await fetch(`${base}/tokens/${id}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) { setMsg({ kind: 'err', text: `Could not revoke (${res.status})` }); return; }
    setTokens((prev) => prev.filter((t) => t.id !== id));
    if (fresh?.id === id) setFresh(null);
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    if (files.length > MAX_FILES) { setMsg({ kind: 'err', text: `Pick at most ${MAX_FILES} files at a time.` }); return; }
    setMsg(null); setResults([]); setUploading({ done: 0, total: files.length });
    const out: UploadResult[] = [];
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const payload: { name: string; text: string }[] = [];
        for (const f of batch) {
          if (f.size > MAX_FILE_BYTES) { out.push({ name: f.name, status: 'failed', note: 'over 30 MB' }); continue; }
          payload.push({ name: f.name, text: await f.text() });
        }
        if (payload.length) {
          const res = await fetch(`${base}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: payload }) });
          const j = (await res.json().catch(() => ({}))) as { results?: UploadResult[]; error?: string };
          if (!res.ok || !j.results) out.push(...payload.map((p) => ({ name: p.name, status: 'failed' as const, note: j.error ?? `upload failed (${res.status})` })));
          else out.push(...j.results);
        }
        setResults([...out]); setUploading({ done: Math.min(i + BATCH, files.length), total: files.length });
      }
      const learned = out.filter((r) => r.status === 'done').length;
      setMsg({ kind: 'ok', text: `Learned from ${learned} of ${out.length} session${out.length === 1 ? '' : 's'}.` });
      router.refresh();
    } finally { setUploading(null); }
  }

  const recent = sessions.slice(0, 20);

  return (
    <section className="card space-y-4" data-panel="claude-code">
      <div className="max-w-2xl space-y-1">
        <h2 className="font-medium">Learn from coding sessions (Claude Code · Codex)</h2>
        <p className="muted text-sm">
          Most real work happens in a coding agent. Your persona can learn from those sessions the same way it learns from chats — your prompts, your pushbacks, what you accept.
        </p>
      </div>
      {msg && <p className={'text-sm ' + (msg.kind === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-600')}>{msg.text}</p>}

      {!readOnly && (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl space-y-1">
              <h3 className="text-sm font-medium">Connect a machine</h3>
              <p className="muted text-sm">Create a token, then add the hook to <code>~/.claude/settings.json</code> on any machine where you use Claude Code. Each finished session is sent here automatically.</p>
            </div>
            <button type="button" className="btn-primary" onClick={createToken} disabled={creating}>{creating ? 'Creating…' : 'Create token'}</button>
          </div>

          {fresh && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <p className="font-medium">Your new token — shown once. Copy it now.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-900" data-token>{fresh.token}</code>
                <CopyButton text={fresh.token} label="Copy token" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="muted text-xs">Paste into <code>~/.claude/settings.json</code> (merge into your existing <code>hooks</code> block if you already have one):</p>
                <CopyButton text={hookSnippet(host, fresh.token)} label="Copy snippet" />
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-snug dark:bg-neutral-900">{hookSnippet(host, fresh.token)}</pre>
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="muted text-xs"><strong>Backfill</strong> — learn from every session already on that machine (run once; seen sessions are skipped):</p>
                <CopyButton text={backfillSnippet(host, fresh.token)} label="Copy command" />
              </div>
              <pre className="overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-snug dark:bg-neutral-900">{backfillSnippet(host, fresh.token)}</pre>
              <p className="muted text-xs">
                Runs when a Claude Code session ends; sends that session’s transcript to your persona. Needs <code>python3</code> + <code>curl</code> on that machine. <code>-k</code> is needed while the certificate is self-signed.
              </p>
            </div>
          )}

          {tokens.length > 0 && (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2" data-token-id={t.id}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="muted text-xs" suppressHydrationWarning>
                      created {new Date(t.createdAt).toLocaleString()} · {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : 'never used'}
                    </div>
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => revoke(t.id)}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl space-y-1">
              <h3 className="text-sm font-medium">Upload sessions</h3>
              <p className="muted text-sm">
                Upload <code>.jsonl</code> session files from Claude Code (<code>~/.claude/projects/&lt;project&gt;/&lt;session&gt;.jsonl</code>) or Codex CLI (<code>~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl</code>) — the format is detected per file. Pick as many as you like (up to 50 at a time); sessions already learned from are skipped.
              </p>
            </div>
            <label className={'btn-primary cursor-pointer ' + (uploading ? 'pointer-events-none opacity-50' : '')}>
              {uploading ? `Uploading ${uploading.done}/${uploading.total}…` : 'Upload .jsonl files'}
              <input type="file" accept=".jsonl" multiple className="hidden" onChange={upload} disabled={!!uploading} />
            </label>
          </div>
          {results.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {results.map((r, i) => (
                <span key={r.name + i} className={'chip ' + (r.status === 'done' ? 'border-green-400' : r.status === 'failed' ? 'border-red-400' : '')} title={r.note ?? ''}>
                  <span className="max-w-[14rem] truncate">{r.name}</span> · {r.status}{r.status === 'done' && r.observations != null ? ` · ${r.observations} obs` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <h3 className="text-sm font-medium">Recent sessions</h3>
        {recent.length === 0 ? (
          <p className="muted text-sm">No Claude Code sessions yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="muted text-xs">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Project</th>
                  <th className="px-3 py-1.5 font-medium">Source</th>
                  <th className="px-3 py-1.5 text-right font-medium">Turns</th>
                  <th className="px-3 py-1.5 text-right font-medium">Observations</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {recent.map((s) => (
                  <tr key={s.sessionId} data-session={s.sessionId} data-status={s.status}>
                    <td className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-xs" title={s.project ?? ''}>{shortProject(s.project)}</td>
                    <td className="px-3 py-1.5 text-xs">{s.source}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.humanTurns}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.observations}</td>
                    <td className="px-3 py-1.5" title={s.note ?? ''}><StatusChip s={s.status} /></td>
                    <td className="muted whitespace-nowrap px-3 py-1.5 text-xs" suppressHydrationWarning>{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
