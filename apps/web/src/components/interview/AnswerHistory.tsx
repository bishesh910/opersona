'use client';
/**
 * Past interview answers — the paper trail behind the model. Evidence links
 * from the Memory tab land here (#a-<id>, briefly highlighted). Editing never
 * erases: the old text is kept as a revision and the analysis reruns; items
 * that only stood on the old wording retire.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export interface AnswerRow {
  id: string;
  categoryLabel: string;
  questionText: string;
  text: string;
  skipped: boolean;
  edited: boolean;
  extraction: { memories: number; traits: number; rules: number; tensions: number; quality: string; note: string } | null;
  extractionStatus: string;
  createdAt: string;
}

function EditForm({ cloneId, row, onDone }: { cloneId: string; row: AnswerRow; onDone: () => void }) {
  const router = useRouter();
  const [text, setText] = useState(row.text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/engine/clones/${cloneId}/interview/answers/${row.id}/edit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.trim() }),
      });
      if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error ?? `failed (${r.status})`); }
      onDone();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not save');
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <textarea className="input min-h-24 w-full text-sm" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus />
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save & re-learn'}</button>
        <button type="button" className="btn-secondary btn-sm" onClick={onDone} disabled={busy}>Cancel</button>
        <span className="muted text-xs">The old wording is kept; anything learned only from it is withdrawn.</span>
      </div>
      {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
    </div>
  );
}

export function AnswerHistory({ cloneId, rows }: { cloneId: string; rows: AnswerRow[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const params = useSearchParams();
  const highlighted = params.get('answer');
  const scrolled = useRef(false);
  useEffect(() => {
    if (highlighted && !scrolled.current) {
      scrolled.current = true;
      document.getElementById(`a-${highlighted}`)?.scrollIntoView({ block: 'center' });
    }
  }, [highlighted]);
  if (!rows.length) return null;
  return (
    <details className="group" open={!!highlighted}>
      <summary className="muted cursor-pointer list-none text-sm">
        Your answers so far ({rows.length})
        <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
      </summary>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id} id={`a-${r.id}`}
            className={'card space-y-1.5 py-3 ' + (highlighted === r.id ? 'ring-2 ring-amber-400' : '')}>
            <div className="flex items-center gap-2">
              <span className="chip">{r.categoryLabel}</span>
              {r.skipped && <span className="chip text-neutral-500">skipped</span>}
              {r.edited && <span className="chip text-neutral-500">edited</span>}
              <span className="muted ml-auto text-xs" suppressHydrationWarning>{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="muted text-xs">{r.questionText}</p>
            {editing === r.id ? (
              <EditForm cloneId={cloneId} row={r} onDone={() => setEditing(null)} />
            ) : r.skipped ? null : (
              <>
                <p className="whitespace-pre-wrap text-sm">{r.text}</p>
                <div className="flex items-center gap-3">
                  <button type="button" className="muted text-xs hover:underline" onClick={() => setEditing(r.id)}>Edit</button>
                  {r.extraction && (
                    <span className="muted text-xs">
                      learned: {r.extraction.memories + r.extraction.traits + r.extraction.rules} item{r.extraction.memories + r.extraction.traits + r.extraction.rules === 1 ? '' : 's'}
                      {r.extraction.tensions > 0 && ` · ${r.extraction.tensions} thread${r.extraction.tensions === 1 ? '' : 's'} to untangle`}
                    </span>
                  )}
                  {r.extractionStatus === 'pending' && <span className="muted text-xs">still reading…</span>}
                  {r.extractionStatus === 'failed' && <span className="text-xs text-amber-600">couldn’t analyse — will retry</span>}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
