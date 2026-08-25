'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AvatarRecipe, EngineEvent } from '@opersona/shared';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { renameConversationAction, deleteChatAction } from '@/actions/conversations';
import { ApprovalCard, type ApprovalItem } from './ApprovalCard';
import { ToolChip, type ToolItem } from './ToolChip';
import { Markdown } from './Markdown';
import { Composer, type PendingAttachmentView } from './Composer';
import { MODEL_LABEL, EFFORT_LABEL, type EffortValue } from './ModelMenu';

export interface HistoryTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolUses: { id: string; name: string; input: unknown; ok?: boolean; preview?: string }[];
}

type Item =
  | { kind: 'user'; key: string; text: string; attachments?: PendingAttachmentView[] }
  /** `settled`: this turn's result line is already accounted for (history, or a result we rendered) — replayed results are dropped. */
  | { kind: 'assistant'; key: string; text: string; streaming: boolean; turnId?: string; settled?: boolean }
  | { kind: 'tool'; key: string; tool: ToolItem; settled?: boolean }
  | { kind: 'approval'; key: string; approval: ApprovalItem }
  | { kind: 'result'; key: string; ok: boolean; cost: number | null; input: number; output: number; cacheRead: number; error?: string }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'status'; key: string; message: string; attempt?: number; max?: number }
  | { kind: 'system'; key: string; text: string };

let seq = 0;
const k = () => `i${Date.now()}-${seq++}`;

/** History stores "[attached: a, b]" on the user turn; split it back out into chips. */
function splitAttached(content: string): { text: string; attachments?: PendingAttachmentView[] } {
  const m = /(?:^|\n)\[attached: ([^\]]+)\]$/.exec(content);
  if (!m) return { text: content };
  const names = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
  return { text: content.slice(0, m.index).trimEnd(), attachments: names.map((name) => ({ id: name, name, mime: /\.(png|jpe?g|gif|webp)$/i.test(name) ? 'image/*' : '' })) };
}

function fromHistory(h: HistoryTurn[]): Item[] {
  const out: Item[] = [];
  for (const t of h) {
    if (t.role === 'user') out.push({ kind: 'user', key: t.id, ...splitAttached(t.content) });
    else if (t.role === 'assistant') {
      for (const tu of t.toolUses) out.push({ kind: 'tool', key: `${t.id}-${tu.id}`, tool: tu, settled: true });
      if (t.content) out.push({ kind: 'assistant', key: t.id, text: t.content, streaming: false, turnId: t.id, settled: true });
    } else out.push({ kind: 'system', key: t.id, text: t.content });
  }
  return out;
}

export type FeedbackVerdict = 'me' | 'not_me';

/** "That's me / Not me" under an assistant turn. With "Not me", a one-line "what would you have done instead?" teaches the persona. */
function TurnFeedback({ cloneId, conversationId, turnId, verdict, onSaved }: {
  cloneId: string; conversationId: string; turnId: string; verdict: FeedbackVerdict | undefined; onSaved: (v: FeedbackVerdict) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'not_me'>('idle');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (verdict) {
    return <div className="muted text-xs" data-feedback={verdict}>Thanks — noted as {verdict === 'me' ? 'you' : 'not you'}.</div>;
  }

  async function send(v: FeedbackVerdict) {
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = { cloneId, turnId, verdict: v };
    const c = comment.trim();
    if (v === 'not_me' && c) body.comment = c;
    const res = await fetch(`/api/engine/conversations/${conversationId}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setErr(j.error ?? `Failed (${res.status})`); return; }
    onSaved(v);
  }

  return (
    <div className="space-y-1 text-xs" data-turn-feedback={turnId}>
      <div className="flex items-center gap-1.5">
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => send('me')}>That’s me</button>
        <button type="button" className={'btn-secondary btn-sm ' + (mode === 'not_me' ? 'border-red-400' : '')} disabled={busy} onClick={() => setMode('not_me')}>Not me</button>
        {err && <span className="text-red-600">{err}</span>}
      </div>
      {mode === 'not_me' && (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void send('not_me'); }}>
          <input
            className="input py-1 text-xs"
            autoFocus
            placeholder="What would you have done instead? (optional — this is what teaches your persona)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={busy}
          />
          <button className="btn-primary btn-sm shrink-0" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </form>
      )}
    </div>
  );
}

/** Inline-editable conversation title (click to rename). */
function Title({ conversationId, title, canEdit, editing, setEditing, onRenamed }: {
  conversationId: string; title: string; canEdit: boolean; editing: boolean; setEditing: (v: boolean) => void; onRenamed: (t: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setDraft(title); }, [title, editing]);
  async function commit() {
    const t = draft.trim();
    setEditing(false);
    if (!t || t === title) return;
    setBusy(true);
    const r = await renameConversationAction(conversationId, t);
    setBusy(false);
    if (r.ok) onRenamed(r.title);
  }
  if (editing) {
    return (
      <input
        className="w-full max-w-md rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-800 dark:bg-neutral-950"
        value={draft}
        autoFocus
        data-title-input
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } if (e.key === 'Escape') { setDraft(title); setEditing(false); } }}
      />
    );
  }
  return (
    <button
      type="button"
      className={'max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-sm ' + (canEdit ? 'hover:bg-neutral-200 dark:hover:bg-neutral-800' : 'cursor-default')}
      onClick={() => canEdit && setEditing(true)}
      title={canEdit ? 'Rename' : undefined}
      disabled={busy}
      data-title
    >
      {title || <span className="text-neutral-500 dark:text-neutral-400">New chat</span>}
    </button>
  );
}

export function ChatView({
  cloneId, cloneName, avatar, conversationId, history, readOnly, canResolveApprovals, feedback: initialFeedback = {}, mode = 'claude',
  title: initialTitle = '', model: initialModel = null, effort: initialEffort = null, userFirstName = '', showCost = true,
  visitorView = false, newHref,
}: {
  mode?: 'claude' | 'clone'; cloneId: string; cloneName: string; avatar: AvatarRecipe | null; conversationId: string; history: HistoryTurn[]; readOnly: boolean; canResolveApprovals: boolean;
  /**
   * Someone else's persona (or the owner reviewing such a conversation): neutral
   * "<Name>'s persona" chip instead of the amber owner-test chip, no That's-me/Not-me,
   * no model menu (visitors use the org default), title not editable.
   */
  visitorView?: boolean;
  /** Where "+ New" points (default: /chat?new=1). */
  newHref?: string;
  /** Existing "that's me / not me" verdicts by turn id (so they survive a reload). */
  feedback?: Record<string, FeedbackVerdict>;
  title?: string;
  model?: string | null;
  effort?: EffortValue | null;
  userFirstName?: string;
  /** false in pilot (Claude-login) mode — the $ figure is an API-price equivalent, not a real charge. */
  showCost?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(() => fromHistory(history));
  const [feedback, setFeedback] = useState<Record<string, FeedbackVerdict>>(initialFeedback);
  const [learning, setLearning] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [model, setModel] = useState<string | null>(initialModel);
  const [effort, setEffort] = useState<EffortValue | null>(initialEffort);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const [connected, setConnected] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const firstSentRef = useRef(history.some((t) => t.role === 'user'));

  useEffect(() => { setTitle(initialTitle); }, [initialTitle]);

  const apply = useCallback((ev: EngineEvent) => {
    if (ev.type === 'result' || ev.type === 'error') setReplying(false);
    setItems((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      switch (ev.type) {
        case 'session':
          return prev;
        case 'text_delta': {
          if (last && last.kind === 'assistant' && last.streaming) next[next.length - 1] = { ...last, text: last.text + ev.text };
          else next.push({ kind: 'assistant', key: k(), text: ev.text, streaming: true });
          return next;
        }
        case 'assistant_message': {
          // Replay of a turn we already loaded from history: drop the provisional bubble, keep the stored one.
          if (ev.turn_id && next.some((i) => i.kind === 'assistant' && i.turnId === ev.turn_id)) {
            const sIdx = next.findLastIndex((i) => i.kind === 'assistant' && i.streaming);
            if (sIdx >= 0) next.splice(sIdx, 1);
            return next;
          }
          // Finalise the streaming bubble (authoritative text), or add one if nothing streamed.
          const idx = next.findLastIndex((i) => i.kind === 'assistant' && i.streaming);
          if (idx >= 0) next[idx] = { kind: 'assistant', key: next[idx]!.key, text: ev.text, streaming: false, turnId: ev.turn_id };
          else if (ev.text) next.push({ kind: 'assistant', key: k(), text: ev.text, streaming: false, turnId: ev.turn_id });
          return next;
        }
        case 'tool_use': {
          if (next.some((i) => i.kind === 'tool' && i.tool.id === ev.id)) return prev; // replay
          // Close any open streaming bubble so the chip appears in order.
          const idx = next.findLastIndex((i) => i.kind === 'assistant' && i.streaming);
          if (idx >= 0) next[idx] = { ...(next[idx] as Extract<Item, { kind: 'assistant' }>), streaming: false };
          next.push({ kind: 'tool', key: `t-${ev.id}`, tool: { id: ev.id, name: ev.name, input: ev.input } });
          return next;
        }
        case 'tool_result': {
          const idx = next.findIndex((i) => i.kind === 'tool' && i.tool.id === ev.id);
          if (idx >= 0) { const it = next[idx] as Extract<Item, { kind: 'tool' }>; next[idx] = { ...it, tool: { ...it.tool, ok: ev.ok, preview: ev.preview } }; }
          return next;
        }
        case 'approval_request': {
          if (next.some((i) => i.kind === 'approval' && i.approval.id === ev.id)) return prev;
          next.push({ kind: 'approval', key: `a-${ev.id}`, approval: { id: ev.id, tool: ev.tool, input: ev.input, question: ev.question, options: ev.options } });
          return next;
        }
        case 'approval_resolved': {
          const idx = next.findIndex((i) => i.kind === 'approval' && i.approval.id === ev.id);
          if (idx >= 0) { const it = next[idx] as Extract<Item, { kind: 'approval' }>; next[idx] = { ...it, approval: { ...it.approval, resolved: ev.behavior } }; }
          return next;
        }
        case 'result': {
          const idx = next.findLastIndex((i) => i.kind === 'assistant' && i.streaming);
          if (idx >= 0) next[idx] = { ...(next[idx] as Extract<Item, { kind: 'assistant' }>), streaming: false };
          // Drop a stale status line; keep the result as a quiet footer.
          if (last && last.kind === 'status') next.pop();
          // The result belongs to the most recent assistant/tool item; if that one is already settled this is a replay.
          const owner = next.findLastIndex((i) => i.kind === 'assistant' || i.kind === 'tool');
          if (owner >= 0) {
            const o = next[owner] as Extract<Item, { kind: 'assistant' | 'tool' }>;
            if (o.settled) return next;
            next[owner] = { ...o, settled: true } as Item;
          }
          next.push({ kind: 'result', key: k(), ok: ev.ok, cost: ev.cost_usd, input: ev.input_tokens, output: ev.output_tokens, cacheRead: ev.cache_read_input_tokens, error: ev.error });
          return next;
        }
        case 'status': {
          // Engine-side retry/status notices: keep one live status line, replace it on each update.
          const idx = next.length - 1;
          const line = { kind: 'status' as const, key: k(), message: ev.message, attempt: ev.attempt, max: ev.max };
          if (idx >= 0 && next[idx]!.kind === 'status') next[idx] = line; else next.push(line);
          return next;
        }
        case 'error':
          next.push({ kind: 'error', key: k(), message: ev.message });
          return next;
        default:
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    // Resume after the last event this tab saw so a reload does not replay the whole ring buffer over the history.
    const storeKey = `chat.ev.${conversationId}`;
    let after = '';
    try { after = sessionStorage.getItem(storeKey) ?? ''; } catch { /* no storage */ }
    const es = new EventSource(`/api/engine/conversations/${conversationId}/events${after ? `?after=${encodeURIComponent(after)}` : ''}`);
    es.onopen = () => setConnected('open');
    es.onerror = () => setConnected(es.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    es.onmessage = (m) => {
      if (m.lastEventId) { try { sessionStorage.setItem(storeKey, m.lastEventId); } catch { /* ignore */ } }
      try { apply(JSON.parse(m.data) as EngineEvent); } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [conversationId, apply]);

  // Follow the stream only while the reader is already near the bottom.
  useEffect(() => { if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' }); }, [items]);
  function onScroll() {
    const el = scrollRef.current; if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  async function send(text: string, attachments: { name: string; mime: string; dataBase64: string }[], views: PendingAttachmentView[]): Promise<boolean> {
    if (busy || replying) return false;
    setBusy(true); setError(null);
    stickToBottom.current = true;
    const key = k();
    setItems((prev) => [...prev, { kind: 'user', key, text, attachments: views.length ? views : undefined }]);
    const res = await fetch(`/api/engine/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloneId, text, ...(attachments.length ? { attachments } : {}) }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `Send failed (${res.status})`);
      setItems((prev) => prev.filter((i) => i.key !== key));
      return false;
    }
    setReplying(true);
    if (!firstSentRef.current) {
      firstSentRef.current = true;
      if (!title) {
        const base = (text || views.map((v) => v.name).join(', ')).replace(/\s+/g, ' ').trim();
        setTitle(base.length > 60 ? base.slice(0, 60).trimEnd() + '…' : base);
      }
      router.refresh(); // picks up the server-side auto-title in the sidebar
    }
    return true;
  }



  async function changeSettings(patch: { model?: string | null; effort?: EffortValue | null }) {
    const res = await fetch(`/api/engine/conversations/${conversationId}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setError(j.error ?? 'Could not switch'); return; }
    if ('model' in patch) { setModel(patch.model ?? null); setNotice(`Switched — next message uses ${MODEL_LABEL(patch.model ?? null)}.`); }
    if ('effort' in patch) { setEffort(patch.effort ?? null); setNotice(`Switched — next message uses ${EFFORT_LABEL(patch.effort ?? null)} thinking.`); }
    setReplying(false);
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const pendingApprovals = items.filter((i) => i.kind === 'approval' && !i.approval.resolved).length;
  const empty = items.length === 0;

  const composer = !readOnly && (
    <Composer
      disabled={busy || replying}
      replying={replying}
      model={model}
      effort={effort}
      notice={notice}
      error={error}
      onSend={send}
      onModel={(m) => changeSettings({ model: m })}
      onEffort={(e) => changeSettings({ effort: e })}
      hideModelMenu={visitorView}
      placeholder={mode === 'clone' ? `Message ${cloneName}…` : 'Message Claude…'}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2" data-chat-view>
      {/* Title row: sidebar toggle (mobile), editable title, "+ New", delete. */}
      {/* Untitled chats show no heading — the nav already says New chat; the title appears once the chat names itself. */}
      {!/^(New chat|Persona test)/.test(title) && (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Title conversationId={conversationId} title={title} canEdit={!readOnly && !visitorView} editing={editingTitle} setEditing={setEditingTitle} onRenamed={(t) => { setTitle(t); router.refresh(); }} />
        </div>

      </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col border-neutral-200 sm:rounded-lg sm:border dark:border-neutral-800">
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs ${mode === 'clone' && !visitorView ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30' : 'border-neutral-200 dark:border-neutral-800'}`}>
          <div className="flex items-center gap-2">
            {mode === 'clone' ? (<><AvatarThumb recipe={avatar} name={cloneName} scale={1.5} state={(() => { const last = items[items.length - 1]; return last && last.kind === 'assistant' && last.streaming && last.text.length > 0 ? 'talking' : replying ? 'thinking' : 'idle'; })()} /><span className="font-medium">{cloneName}</span>{visitorView
              ? <span className="chip border-blue-400 text-blue-700 dark:border-blue-700 dark:text-blue-400" data-visitor-chip>{cloneName}&rsquo;s persona</span>
              : <span className="chip border-amber-400 text-amber-700 dark:text-amber-400">persona test — replies as you; your ratings teach it</span>}</>)
              : (<><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900">C</span><span className="font-medium">Claude</span><span className="muted hidden sm:inline">· learns how you think, automatically</span></>)}
            <span className={'inline-block h-1.5 w-1.5 rounded-full ' + (connected === 'open' ? 'bg-green-500' : connected === 'connecting' ? 'animate-pulse bg-amber-500' : 'bg-red-500')} title={`stream ${connected}`} />
            {pendingApprovals > 0 && <span className="chip border-amber-400">{pendingApprovals} awaiting approval</span>}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              {learning && (
                <span className="muted text-xs" data-learning>
                  {learning} — <Link href="/me" className="underline">see How I think</Link>
                </span>
              )}

            </div>
          )}
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="scroll-touch flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {empty && <p className="muted text-sm">{visitorView ? `Ask ${cloneName}'s persona anything — it answers the way ${cloneName} would, from what they chose to share.` : mode === 'clone' ? 'Ask anything — see whether the answer sounds like you. What you type here is never mined for patterns — but your That\u2019s me / Not me ratings do teach your persona.' : 'Say hello. Ask anything, or walk through a problem the way you would — your persona learns from it.'}</p>}
          {items.map((it) => {
            switch (it.kind) {
              case 'user':
                return (
                  <div key={it.key} className="ml-auto max-w-[80%] space-y-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900" data-user-msg>
                    {it.attachments && it.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {it.attachments.map((a) => a.previewUrl
                          ? <img key={a.id} src={a.previewUrl} alt={a.name} className="h-24 max-w-48 rounded object-cover" />
                          : <span key={a.id} className="chip max-w-60 truncate" title={a.name}>{a.name}</span>)}
                      </div>
                    )}
                    {it.text && <Markdown text={it.text} className="md-on-dark" />}
                  </div>
                );
              case 'assistant':
                return (
                  <div key={it.key} className="max-w-[85%] space-y-1" data-assistant-msg>
                    <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
                      <Markdown text={it.text} />
                      {it.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-neutral-500 align-middle" data-cursor />}
                    </div>
                    {mode === 'clone' && !readOnly && !visitorView && !it.streaming && it.turnId && (
                      <TurnFeedback
                        cloneId={cloneId}
                        conversationId={conversationId}
                        turnId={it.turnId}
                        verdict={feedback[it.turnId]}
                        onSaved={(v) => setFeedback((f) => ({ ...f, [it.turnId!]: v }))}
                      />
                    )}
                  </div>
                );
              case 'tool':
                return <ToolChip key={it.key} item={it.tool} />;
              case 'approval':
                return (
                  <ApprovalCard key={it.key} item={it.approval} canResolve={canResolveApprovals}
                    onResolved={(id, behavior) => apply({ type: 'approval_resolved', id, behavior })} />
                );
              case 'result':
                return (
                  <div key={it.key} className="muted flex flex-wrap gap-x-3 text-xs" data-result>
                    <span>{it.ok ? 'done' : 'failed'}</span>
                    {showCost && it.cost != null && <span title="API-price equivalent — informational on a Claude login, billed only in API-key mode">${it.cost.toFixed(4)}</span>}
                    <span>in {it.input.toLocaleString()}</span>
                    <span>out {it.output.toLocaleString()}</span>
                    <span>cache read {it.cacheRead.toLocaleString()}</span>
                    {it.error && <span className="text-red-600">{it.error}</span>}
                  </div>
                );
              case 'error':
                return <div key={it.key} className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">{it.message}</div>;
              case 'status':
                return (
                  <div key={it.key} className="muted text-xs italic">
                    {it.message}{it.attempt != null && it.max != null && ` (attempt ${it.attempt}/${it.max})`}
                  </div>
                );
              case 'system':
                return <div key={it.key} className="muted text-center text-xs">{it.text}</div>;
            }
          })}
          {replying && !items.some((i) => i.kind === 'assistant' && i.streaming) && (
            <div className="inline-flex items-center gap-1 rounded-lg bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800" data-thinking aria-label="thinking">
              <span className="think-dot inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
              <span className="think-dot inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
              <span className="think-dot inline-block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
            </div>
          )}
          {replying && !items.some((i) => i.kind === 'assistant' && i.streaming) && (
            <div className="muted text-xs italic" data-thinking>Thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>

        {readOnly ? (
          <div className="muted border-t border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">{visitorView ? 'Read-only: this is a colleague’s conversation with your persona — only they can write here.' : 'Read-only: only the persona owner can chat.'}</div>
        ) : (
          <div className="border-t border-neutral-200 p-2 dark:border-neutral-800">{composer}</div>
        )}
      </div>
    </div>
  );
}
