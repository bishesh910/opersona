'use client';
/**
 * The interview — a thoughtful conversation, not a form. One large question at
 * a time, a real textarea, per-category progress underneath. Pause = just
 * leave; the server resumes exactly where you stopped. No AI jargon anywhere.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CategoryBars, type CategoryProgress } from './CategoryBars';

interface Question {
  id: string;
  category: string;
  categoryLabel: string;
  kind: 'behavioural' | 'follow_up' | 'contradiction';
  text: string;
  hint: string | null;
}
interface Progress {
  categories: CategoryProgress[];
  answered: number;
  knowledge: { memories: number; traits: number; rules: number };
}
interface NextPayload { question: Question | null; progress: Progress }

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `request failed (${r.status})`);
  return j;
}

const KIND_CHIP: Record<Question['kind'], string | null> = {
  behavioural: null,
  follow_up: 'digging deeper',
  contradiction: 'untangling a thread',
};

export function InterviewRoom({ cloneId }: { cloneId: string }) {
  const [q, setQ] = useState<Question | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const base = `/api/engine/clones/${cloneId}/interview`;

  const grow = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 420) + 'px';
  }, []);

  useEffect(() => {
    let alive = true;
    post<NextPayload>(`${base}/next`)
      .then((r) => { if (alive) { setQ(r.question); setProgress(r.progress); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'could not load the interview'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [base]);

  async function send(skipped: boolean) {
    if (!q || busy) return;
    const payload = skipped ? { questionId: q.id, skipped: true } : { questionId: q.id, text: text.trim() };
    if (!skipped && !text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<NextPayload>(`${base}/answer`, payload);
      setQ(r.question); setProgress(r.progress);
      setText('');
      setSaved(!skipped);
      areaRef.current?.focus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="muted py-16 text-center text-sm">finding the right question…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {q ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{q.categoryLabel}</span>
            {KIND_CHIP[q.kind] && (
              <span className="chip border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400">{KIND_CHIP[q.kind]}</span>
            )}
          </div>
          <h1 className="text-xl font-medium leading-snug sm:text-2xl">{q.text}</h1>
          {q.hint && <p className="muted text-sm">{q.hint}</p>}
          <textarea
            ref={areaRef}
            className="input min-h-36 w-full resize-none text-base leading-relaxed"
            placeholder="Take your time — a real moment beats a general answer."
            value={text}
            disabled={busy}
            onChange={(e) => { setText(e.target.value); setSaved(false); grow(); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(false); } }}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={() => void send(false)}>
              {busy ? 'Saving…' : 'That’s my answer'}
            </button>
            <button type="button" className="muted text-sm hover:underline" disabled={busy} onClick={() => void send(true)}>
              Skip this one
            </button>
            <span className="muted ml-auto hidden text-xs sm:inline">⌘↵ sends</span>
          </div>
          {saved && <p className="text-xs text-emerald-700 dark:text-emerald-400">Saved — I’m folding that in while you keep going.</p>}
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        </section>
      ) : (
        <section className="card space-y-2 py-8 text-center">
          <p className="font-medium">That’s everything I have for now.</p>
          <p className="muted text-sm">New questions appear as I study your answers — check back after your next few conversations.</p>
        </section>
      )}

      {progress && (
        <section className="space-y-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <div className="hidden sm:block"><CategoryBars categories={progress.categories} /></div>
          <div className="sm:hidden"><CategoryBars categories={progress.categories} compactSummary /></div>
          <p className="muted text-xs">
            {progress.answered} answer{progress.answered === 1 ? '' : 's'} so far
            {progress.knowledge.memories + progress.knowledge.traits + progress.knowledge.rules > 0 && (
              <> · {progress.knowledge.memories} memor{progress.knowledge.memories === 1 ? 'y' : 'ies'}, {progress.knowledge.traits} trait{progress.knowledge.traits === 1 ? '' : 's'}, {progress.knowledge.rules} rule{progress.knowledge.rules === 1 ? '' : 's'} learned — see the Memory tab</>
            )}
            . Leave any time — we pick up right here.
          </p>
        </section>
      )}
    </div>
  );
}
