'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Markdown } from '@/components/chat/Markdown';

export interface SelfTestItem {
  id: string;
  domain: string;
  question: string;
  answer: string;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? `Failed (${res.status})` };
  }
  return { ok: true };
}

function TestCard({ cloneId, item, readOnly, onRated }: { cloneId: string; item: SelfTestItem; readOnly: boolean; onRated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [askInstead, setAskInstead] = useState(false);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function rate(verdict: 'me' | 'not_me') {
    setBusy(true); setErr(null);
    const body: { verdict: string; comment?: string } = { verdict };
    if (verdict === 'not_me' && comment.trim()) body.comment = comment.trim();
    const r = await post(`/api/engine/clones/${cloneId}/self-test/${item.id}/rate`, body);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
    setDone(true);
    onRated();
  }

  return (
    <li className={'card space-y-2 py-3 ' + (done ? 'opacity-50' : '')}>
      <div className="flex items-start justify-between gap-3">
        <span className="chip shrink-0">{item.domain || 'general'}</span>
        {done && <span className="muted text-xs">noted</span>}
      </div>
      <p className="muted text-sm italic">“{item.question}”</p>
      <Markdown text={item.answer} className="text-sm" />
      {!readOnly && !done && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => rate('me')}>That’s me</button>
            <button
              type="button"
              className={'btn-secondary btn-sm ' + (askInstead ? 'border-red-400' : '')}
              disabled={busy}
              onClick={() => { if (askInstead) void rate('not_me'); else setAskInstead(true); }}
            >
              Not me
            </button>
            {busy && <span className="muted text-xs">Saving…</span>}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
          {askInstead && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); void rate('not_me'); }}
            >
              <input
                className="input w-full max-w-md text-sm"
                autoFocus
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What would you have done instead? (helps a lot — but optional)"
                disabled={busy}
              />
              <button type="submit" className="btn-secondary btn-sm shrink-0" disabled={busy}>Send</button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

export function SelfTestPanel({ cloneId, unrated, history, accuracyPct, readOnly }: {
  cloneId: string;
  unrated: SelfTestItem[];
  /** Last 10 rated verdicts, oldest → newest. */
  history: ('me' | 'not_me')[];
  /** 0–100 from the engine accuracy endpoint, or null when nothing rated yet. */
  accuracyPct: number | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ratedCount, setRatedCount] = useState(0);

  async function run(regenerate = false) {
    setRunning(true); setErr(null);
    const r = await post(`/api/engine/clones/${cloneId}/self-test`, regenerate ? { regenerate: true } : {});
    setRunning(false);
    if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
    router.refresh();
  }

  function onRated() {
    setRatedCount((n) => {
      const next = n + 1;
      // Refresh once the whole batch is rated so the accuracy tile catches up.
      if (next >= unrated.length) router.refresh();
      return next;
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Does it sound like me?</h2>
          <p className="muted max-w-2xl text-sm">
            Your persona answers fresh problems from domains you haven’t chatted about. Tell it which answers sound like you.
          </p>
        </div>
        {(history.length > 0 || accuracyPct != null) && (
          <div className="flex items-center gap-2" title="Last 10 rated self-tests">
            <span className="flex items-center gap-1">
              {history.map((v, i) => (
                <span key={i} className={'h-2 w-2 rounded-full ' + (v === 'me' ? 'bg-green-500' : 'bg-red-500')} />
              ))}
            </span>
            {accuracyPct != null && <span className="muted text-xs">sounds like me {accuracyPct}% of the time</span>}
          </div>
        )}
      </div>

      {unrated.length > 0 ? (
        <div className="space-y-2">
          {!readOnly && (
            <div className="flex items-center gap-3">
              <button type="button" className="btn-secondary btn-sm" onClick={() => run(true)} disabled={running} title="Throw these away and ask 3 different questions">
                {running ? 'Regenerating…' : 'New questions'}
              </button>
              {running && <span className="muted text-xs">~1 min</span>}
              {err && <span className="text-xs text-red-600">{err}</span>}
            </div>
          )}
          <ul className="space-y-2">
            {unrated.map((t) => <TestCard key={t.id} cloneId={cloneId} item={t} readOnly={readOnly} onRated={onRated} />)}
          </ul>
        </div>
      ) : !readOnly ? (
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary btn-sm" onClick={() => run(false)} disabled={running}>
            {running ? 'Running…' : 'Run a self-test'}
          </button>
          {running && <span className="muted text-xs">Asking your persona 3 fresh problems… ~1 min</span>}
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      ) : (
        <p className="muted text-xs">No open self-tests.</p>
      )}
    </section>
  );
}
