'use client';
import { useState } from 'react';

export interface ApprovalItem {
  id: string;
  tool: string;
  input: unknown;
  question?: string;
  options?: string[];
  resolved?: 'allow' | 'deny';
}

/** Resolve a pending approval via the engine proxy. Shared by the chat view and the /approvals page. */
export async function resolveApproval(id: string, body: { behavior: 'allow' | 'deny'; answer?: string; message?: string }): Promise<string | null> {
  const res = await fetch(`/api/engine/approvals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? `Failed (${res.status})`;
}

export function ApprovalCard({ item, canResolve, onResolved }: { item: ApprovalItem; canResolve: boolean; onResolved?: (id: string, behavior: 'allow' | 'deny') => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const isQuestion = !!item.question;

  async function send(body: { behavior: 'allow' | 'deny'; answer?: string; message?: string }) {
    setBusy(true); setError(null);
    const err = await resolveApproval(item.id, body);
    setBusy(false);
    if (err) setError(err); else onResolved?.(item.id, body.behavior);
  }

  return (
    <div className="rounded-xl border border-amber-300/80 bg-amber-50/60 p-4 text-sm shadow-[0_2px_0_0_var(--color-amber-200)] dark:border-amber-700/60 dark:bg-amber-950/30 dark:shadow-[0_2px_0_0_rgb(120_53_15/0.5)]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">{isQuestion ? 'Your persona has a question' : `Approve tool: ${item.tool}`}</span>
        {item.resolved && <span className="chip">{item.resolved === 'allow' ? (isQuestion ? 'answered' : 'allowed') : 'denied'}</span>}
      </div>
      {isQuestion ? (
        <p className="mb-2 whitespace-pre-wrap">{item.question}</p>
      ) : (
        <pre className="mb-2 max-h-48 overflow-auto rounded bg-white/70 p-2 font-mono text-xs dark:bg-black/30">{JSON.stringify(item.input, null, 2)}</pre>
      )}
      {!item.resolved && canResolve && (
        <div className="space-y-2">
          {isQuestion ? (
            <>
              {item.options && item.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {item.options.map((o) => (
                    <button key={o} type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => send({ behavior: 'allow', answer: o })}>{o}</button>
                  ))}
                </div>
              )}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) void send({ behavior: 'allow', answer: answer.trim() }); }}>
                <input className="input" placeholder="Type an answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
                <button className="btn-primary btn-sm" disabled={busy || !answer.trim()}>Answer</button>
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => send({ behavior: 'deny', message: 'Owner declined to answer' })}>Decline</button>
              </form>
            </>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => send({ behavior: 'allow' })}>Allow</button>
              <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => send({ behavior: 'deny', message: 'Owner denied this tool call' })}>Deny</button>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
      {!item.resolved && !canResolve && <p className="muted text-xs">Waiting for the persona owner.</p>}
    </div>
  );
}
