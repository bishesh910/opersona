'use client';
/**
 * The interview is a CHAT: your persona messages you, you answer like you'd
 * text a friend — short is fine, the probing is its job. Behind the bubbles
 * the same machinery runs: a deterministic picker chooses what to explore,
 * threads wrap into answers, extraction turns them into knowledge. Pause by
 * leaving; the conversation resumes exactly where it stopped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarRecipe } from '@opersona/shared';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
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
interface ChatMessage { id: string; role: 'interviewer' | 'user'; text: string; questionId: string; createdAt: string }
interface ChatState { question: Question | null; messages: ChatMessage[]; progress: Progress }

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `request failed (${r.status})`);
  return j;
}

const KIND_CHIP: Record<Question['kind'], string | null> = {
  behavioural: null,
  follow_up: 'digging deeper',
  contradiction: 'untangling a thread',
};

function Bubble({ msg, avatar, personaName }: { msg: ChatMessage; avatar: AvatarRecipe | null; personaName: string }) {
  const mine = msg.role === 'user';
  return (
    <div className={'flex items-end gap-2 ' + (mine ? 'justify-end' : 'justify-start')}>
      {!mine && <div className="shrink-0 pb-0.5"><AvatarThumb recipe={avatar} name={personaName} scale={1.5} /></div>}
      <div className={
        'max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[70%] ' +
        (mine
          ? 'rounded-br-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'rounded-bl-md bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100')
      }>
        {msg.text}
      </div>
    </div>
  );
}

function Typing({ avatar, personaName }: { avatar: AvatarRecipe | null; personaName: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="shrink-0 pb-0.5"><AvatarThumb recipe={avatar} name={personaName} scale={1.5} state="thinking" /></div>
      <div className="rounded-2xl rounded-bl-md bg-neutral-100 px-3.5 py-2.5 dark:bg-neutral-800">
        <span className="think-dot mx-0.5 inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
        <span className="think-dot mx-0.5 inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 [animation-delay:120ms] dark:bg-neutral-500" />
        <span className="think-dot mx-0.5 inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 [animation-delay:240ms] dark:bg-neutral-500" />
      </div>
    </div>
  );
}

export function InterviewRoom({ cloneId, personaName, avatar }: { cloneId: string; personaName: string; avatar: AvatarRecipe | null }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const base = `/api/engine/clones/${cloneId}/interview/chat`;

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
  }, []);

  useEffect(() => {
    let alive = true;
    post<ChatState>(`${base}/state`)
      .then((s) => { if (alive) { setState(s); scrollDown(); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'could not load the interview'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [base, scrollDown]);

  const grow = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  async function send() {
    const t = text.trim();
    if (!t || busy || !state) return;
    setBusy(true); setErr(null);
    // Optimistic bubble so the chat feels instant.
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', text: t, questionId: state.question?.id ?? '', createdAt: new Date().toISOString() };
    setState((s) => s ? { ...s, messages: [...s.messages, optimistic] } : s);
    setText('');
    if (areaRef.current) areaRef.current.style.height = 'auto';
    scrollDown();
    try {
      const s = await post<ChatState>(`${base}/send`, { text: t });
      setState(s);
      scrollDown();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not send — try again');
      setState((s) => s ? { ...s, messages: s.messages.filter((m) => m.id !== optimistic.id) } : s);
      setText(t);
    } finally {
      setBusy(false);
      areaRef.current?.focus();
    }
  }

  async function skip() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const s = await post<ChatState>(`${base}/skip`);
      setState(s);
      scrollDown();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not skip');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="muted py-16 text-center text-sm">opening the conversation…</div>;
  if (!state) return <p className="py-16 text-center text-sm text-red-600">{err ?? 'could not load the interview'}</p>;

  const q = state.question;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex min-h-[40dvh] flex-col justify-end space-y-2.5 rounded-xl border border-neutral-200 p-3 sm:p-4 dark:border-neutral-800">
          {state.messages.map((m) => <Bubble key={m.id} msg={m} avatar={avatar} personaName={personaName} />)}
          {busy && <Typing avatar={avatar} personaName={personaName} />}
          {!q && !busy && (
            <p className="muted py-4 text-center text-sm">That’s everything I have for now — new questions appear as I study your answers.</p>
          )}
          <div ref={endRef} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {q && <span className="chip">{q.categoryLabel}</span>}
          {q && KIND_CHIP[q.kind] && (
            <span className="chip border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400">{KIND_CHIP[q.kind]}</span>
          )}
          {q && <button type="button" className="muted text-xs hover:underline" disabled={busy} onClick={() => void skip()}>skip this one</button>}
          {err && <span className="text-xs text-red-600" role="alert">{err}</span>}
        </div>
        {q && (
          <div className="flex items-end gap-2">
            <textarea
              ref={areaRef}
              rows={1}
              className="input max-h-40 min-h-0 flex-1 resize-none py-2.5 text-base leading-relaxed"
              placeholder="Message your persona — short is fine"
              value={text}
              disabled={busy}
              onChange={(e) => { setText(e.target.value); grow(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              autoFocus
            />
            <button type="button" className="btn-primary shrink-0" disabled={busy || !text.trim()} onClick={() => void send()}>Send</button>
          </div>
        )}
      </div>

      <section className="space-y-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <div className="hidden sm:block"><CategoryBars categories={state.progress.categories} /></div>
        <div className="sm:hidden"><CategoryBars categories={state.progress.categories} compactSummary /></div>
        <p className="muted text-xs">
          {state.progress.answered} thread{state.progress.answered === 1 ? '' : 's'} finished
          {state.progress.knowledge.memories + state.progress.knowledge.traits + state.progress.knowledge.rules > 0 && (
            <> · {state.progress.knowledge.memories} memor{state.progress.knowledge.memories === 1 ? 'y' : 'ies'}, {state.progress.knowledge.traits} trait{state.progress.knowledge.traits === 1 ? '' : 's'}, {state.progress.knowledge.rules} rule{state.progress.knowledge.rules === 1 ? '' : 's'} learned — see the Memory tab</>
          )}
          . Leave any time — the chat picks up right here.
        </p>
      </section>
    </div>
  );
}
