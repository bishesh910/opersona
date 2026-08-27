'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isSealed, loadSealKey, storeSealKey, sealDecrypt, sealEncrypt, sealKeyFingerprint } from '@/lib/seal-client';
import { useRouter } from 'next/navigation';
import type { AvatarRecipe, EngineEvent } from '@opersona/shared';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { renameConversationAction, deleteChatAction } from '@/actions/conversations';
import { ApprovalCard, type ApprovalItem } from './ApprovalCard';
import { ToolChip, type ToolItem } from './ToolChip';
import { ClaudeGlyph } from './ClaudeGlyph';
import { Markdown } from './Markdown';
import { Composer, type PendingAttachmentView } from './Composer';
import { ConfirmDialog } from '@/components/shell/Dialog';
import { MODEL_LABEL, EFFORT_LABEL, type EffortValue } from './ModelMenu';

export interface HistoryTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolUses: { id: string; name: string; input: unknown; ok?: boolean; preview?: string }[];
  files?: { path: string; size: number }[];
}

type Item =
  | { kind: 'user'; key: string; text: string; attachments?: PendingAttachmentView[] }
  /** `settled`: this turn's result line is already accounted for (history, or a result we rendered) — replayed results are dropped. */
  | { kind: 'assistant'; key: string; text: string; streaming: boolean; turnId?: string; settled?: boolean }
  | { kind: 'tool'; key: string; tool: ToolItem; settled?: boolean }
  | { kind: 'approval'; key: string; approval: ApprovalItem }
  | { kind: 'files'; key: string; files: { path: string; size: number }[]; turnId?: string }
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
      if (t.files && t.files.length) out.push({ kind: 'files', key: `${t.id}-files`, files: t.files, turnId: t.id });
    } else out.push({ kind: 'system', key: t.id, text: t.content });
  }
  return out;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Download chips for files the chat produced in its workspace. Images preview inline. */
function FileChips({ conversationId, files }: { conversationId: string; files: { path: string; size: number }[] }) {
  const href = (p: string) => `/api/engine/conversations/${conversationId}/files?path=${encodeURIComponent(p)}`;
  return (
    <div className="flex flex-wrap gap-2" data-files>
      {files.map((f) => {
        const name = f.path.split('/').pop() || f.path;
        const isImg = IMG_RE.test(name) && !/\.svg$/i.test(name);
        return (
          <a
            key={f.path}
            href={href(f.path)}
            download={name}
            className="group flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-xs no-underline shadow-[0_2px_0_0_var(--color-neutral-200)] transition hover:-translate-y-px hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_2px_0_0_var(--color-neutral-800)] dark:hover:border-neutral-500"
            title={`${f.path} · ${fmtSize(f.size)} — click to download`}
          >
            {isImg
              ? <img src={href(f.path)} alt={name} className="h-9 w-9 shrink-0 rounded-lg object-cover" style={{ imageRendering: 'auto' }} />
              : <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-neutral-100 text-sm dark:bg-neutral-800">↓</span>}
            <span className="min-w-0">
              <span className="block max-w-52 truncate font-medium">{name}</span>
              <span className="muted">{fmtSize(f.size)}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
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
    <div className="mt-1.5 space-y-1.5 text-xs" data-turn-feedback={turnId}>
      <div className="flex items-center gap-1.5 transition-opacity sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <button type="button" disabled={busy} onClick={() => send('me')}
          className="inline-flex h-6 items-center rounded-full border border-neutral-200 bg-white px-2.5 text-[11px] text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:text-neutral-100">That’s me</button>
        <button type="button" disabled={busy} onClick={() => setMode('not_me')}
          className={'inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] transition '
            + (mode === 'not_me'
              ? 'border-amber-400/80 bg-amber-50 text-amber-700 dark:border-amber-600/70 dark:bg-amber-950/40 dark:text-amber-400'
              : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:text-neutral-100')}>Not me</button>
        {err && <span className="text-red-600 dark:text-red-400">{err}</span>}
      </div>
      {mode === 'not_me' && (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void send('not_me'); }}>
          <input
            className="w-full rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs outline-none transition focus:border-amber-400/70 focus:ring-2 focus:ring-amber-200/60 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-amber-500/50 dark:focus:ring-amber-500/15"
            autoFocus
            placeholder="What would you have done instead? (optional — this is what teaches your persona)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={busy}
          />
          <button className="btn-primary btn-sm h-7 shrink-0 rounded-full" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
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
      className={'max-w-full truncate rounded-md px-1.5 py-0.5 text-left text-[13px] text-neutral-500 dark:text-neutral-400 ' + (canEdit ? 'hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200' : 'cursor-default')}
      onClick={() => canEdit && setEditing(true)}
      title={canEdit ? 'Rename' : undefined}
      disabled={busy}
      data-title
    >
      {title || <span className="text-neutral-500 dark:text-neutral-400">New chat</span>}
    </button>
  );
}

/** Engine errors worth translating for humans (stable prefixes from the engine). */
function friendlyErr(m: string): string {
  if (m.startsWith('no_api_key:')) return 'No API key connected — add yours in Settings → Claude access to start chatting.';
  if (m.startsWith('bridge_offline:')) return 'Your bridge is paired but not running — run `npx opersona@latest` on your machine, then resend.';
  if (/bridge (disconnected|reconnected elsewhere)/.test(m)) return 'Your bridge went offline mid-reply — run `npx opersona@latest` again and resend this message.';
  if (/model_not_found|not_found_error|no access to.*model|unknown model|does not exist.*model/i.test(m)) return 'Your Claude doesn\u2019t have access to the selected model — pick a different one in Settings \u2192 Models (Fable/Mythos-tier access varies by plan).';
  if (m.startsWith('budget_exceeded:')) return m.replace('budget_exceeded:', 'Monthly budget reached —') + '. Raise or clear it in Settings → Models.';
  return m;
}

export function ChatView({
  cloneId, cloneName, avatar, conversationId, history, readOnly, canResolveApprovals, feedback: initialFeedback = {}, mode = 'claude',
  title: initialTitle = '', model: initialModel = null, effort: initialEffort = null, userFirstName = '', showCost = true,
  visitorView = false, newHref, embedded = false, initialLive = false, keyMissing = null, seal = null,
}: {
  mode?: 'claude' | 'clone'; cloneId: string; cloneName: string; avatar: AvatarRecipe | null; conversationId: string; history: HistoryTurn[]; readOnly: boolean; canResolveApprovals: boolean;
  /**
   * Someone else's persona (or the owner reviewing such a conversation): neutral
   * "<Name>'s persona" chip instead of the amber owner-test chip, no That's-me/Not-me,
   * no model menu (visitors use the org default), title not editable.
   */
  visitorView?: boolean;
  /** Inside the office side panel: skip the header bar (the panel provides identity + actions). */
  embedded?: boolean;
  /** The engine is still generating for this conversation: show the thinking state
   *  immediately and replay the in-flight turn's events (nothing gets lost when you
   *  click away mid-reply and come back). */
  initialLive?: boolean;
  /** Where "+ New" points (default: /chat?new=1). */
  newHref?: string;
  /** The workspace paying for this conversation has no Anthropic key: 'mine' = the
   *  viewer's own workspace (show the add-key CTA), 'theirs' = someone else's
   *  (persona owner hasn't connected Claude). Composer is replaced by a gate card. */
  keyMissing?: 'mine' | 'theirs' | null;
  /** Sealed-conversations key fingerprint for this workspace (null = not sealed).
   *  Content decrypts in THIS browser; the server stores only ciphertext. */
  seal?: string | null;
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
  const [sealKey, setSealKey] = useState<string | null>(null);
  useEffect(() => {
    if (!seal) return;
    const k = loadSealKey(seal);
    setSealKey(k);
    if (!history.some((t) => isSealed(t.content))) return;
    if (!k) {
      setItems(fromHistory(history.map((t) => (isSealed(t.content) ? { ...t, content: '🔒 Sealed message — unlock this device with your key (below).' } : t))));
      return;
    }
    void (async () => {
      const dec = await Promise.all(history.map(async (t) =>
        isSealed(t.content) ? { ...t, content: await sealDecrypt(k, t.content).catch(() => '🔒 (cannot decrypt — wrong key for this workspace?)') } : t));
      setItems(fromHistory(dec));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seal]);
  const [feedback, setFeedback] = useState<Record<string, FeedbackVerdict>>(initialFeedback);
  const [learning, setLearning] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [model, setModel] = useState<string | null>(initialModel);
  const [effort, setEffort] = useState<EffortValue | null>(initialEffort);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(initialLive);
  const [connected, setConnected] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const firstSentRef = useRef(history.some((t) => t.role === 'user'));

  useEffect(() => { setTitle(initialTitle); }, [initialTitle]);

  const sawEventRef = useRef(false);
  // Safety valve: initialLive comes from the conversation row, which can be
  // stranded at 'live' by a failed send. If the event stream stays silent for
  // 10s after mount, the turn is not actually running — unlock the composer.
  useEffect(() => {
    if (!initialLive) return;
    const t = setTimeout(() => { if (!sawEventRef.current) setReplying(false); }, 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback((ev: EngineEvent) => {
    sawEventRef.current = true;
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
          // Broadcast for ambient listeners (the office animates a mail envelope on consults).
          try { window.dispatchEvent(new CustomEvent('opersona:tool', { detail: { conversationId, name: ev.name, input: ev.input } })); } catch { /* ok */ }
          // Close any open streaming bubble so the chip appears in order.
          const idx = next.findLastIndex((i) => i.kind === 'assistant' && i.streaming);
          if (idx >= 0) next[idx] = { ...(next[idx] as Extract<Item, { kind: 'assistant' }>), streaming: false };
          next.push({ kind: 'tool', key: `t-${ev.id}`, tool: { id: ev.id, name: ev.name, input: ev.input } });
          return next;
        }
        case 'tool_result': {
          try {
            const tu = next.find((i) => i.kind === 'tool' && i.tool.id === ev.id) as Extract<Item, { kind: 'tool' }> | undefined;
            if (tu) window.dispatchEvent(new CustomEvent('opersona:tool-result', { detail: { conversationId, name: tu.tool.name, input: tu.tool.input, ok: ev.ok } }));
          } catch { /* ok */ }
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
        case 'files': {
          if (ev.turn_id && next.some((i) => i.kind === 'files' && i.turnId === ev.turn_id)) return prev;
          next.push({ kind: 'files', key: k(), files: ev.files, turnId: ev.turn_id });
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
          next.push({ kind: 'result', key: k(), ok: ev.ok, cost: ev.cost_usd, input: ev.input_tokens, output: ev.output_tokens, cacheRead: ev.cache_read_input_tokens, error: ev.error ? friendlyErr(ev.error) : ev.error });
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
          next.push({ kind: 'error', key: k(), message: friendlyErr(ev.message) });
          return next;
        default:
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    // Resume after the last event this tab saw so a reload does not replay the whole ring buffer over the history.
    // While the engine is mid-reply, replay the whole in-flight TURN instead — the
    // stored cursor would skip the partial text streamed before we unmounted.
    const storeKey = `chat.ev.${conversationId}`;
    let after = '';
    if (initialLive) after = 'turn';
    else try { after = sessionStorage.getItem(storeKey) ?? ''; } catch { /* no storage */ }
    const es = new EventSource(`/api/engine/conversations/${conversationId}/events${after ? `?after=${encodeURIComponent(after)}` : ''}`);
    es.onopen = () => setConnected('open');
    es.onerror = () => setConnected(es.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    es.onmessage = (m) => {
      if (m.lastEventId) { try { sessionStorage.setItem(storeKey, m.lastEventId); } catch { /* ignore */ } }
      try { apply(JSON.parse(m.data) as EngineEvent); } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [conversationId, apply, initialLive]);

  // Follow the stream only while the reader is already near the bottom.
  useEffect(() => { if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' }); }, [items]);
  function onScroll() {
    const el = scrollRef.current; if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  async function send(text: string, attachments: { name: string; mime: string; dataBase64: string }[], views: PendingAttachmentView[]): Promise<boolean> {
    if (seal && !sealKey) { setError('This workspace seals conversations — unlock this device with your key first (below).'); return false; }
    if (busy || replying) return false;
    setBusy(true); setError(null);
    stickToBottom.current = true;
    const key = k();
    setItems((prev) => [...prev, { kind: 'user', key, text, attachments: views.length ? views : undefined }]);
    const res = await fetch(`/api/engine/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cloneId, text,
        ...(seal && sealKey && text ? { sealed: await sealEncrypt(sealKey, text) } : {}),
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(friendlyErr(j.error ?? `Send failed (${res.status})`));
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

  const headState = (() => { const last = items[items.length - 1]; return last && last.kind === 'assistant' && last.streaming && last.text.length > 0 ? 'talking' : replying ? 'thinking' : 'idle'; })();
  const showTitle = title !== '' && !/^(New chat|Persona test)/.test(title);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);

  const firstName = userFirstName ? `, ${userFirstName}` : '';
  const daypart = hour === null ? null : hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const greeting = visitorView ? `Ask ${cloneName}’s persona`
    : mode === 'clone' ? 'Does it sound like you?'
    : daypart === null ? `Hello${firstName}.`
    : daypart === 'night' ? `Night shift${firstName}?`
    : daypart === 'morning' ? `Good morning${firstName}.`
    : daypart === 'afternoon' ? `Good afternoon${firstName}.` : `Good evening${firstName}.`;
  const suggestions = visitorView
    ? ['What are you working on right now?', 'How do you like to receive feedback?', 'What should I know before our next meeting?']
    : mode === 'clone'
      ? ['How would I push back on an unrealistic deadline?', 'Summarize my week the way I would', 'How would I explain my current project to a new hire?']
      : ['Help me think through a decision', 'Draft a tricky message with me', 'Explain something like I have five minutes'];

  const modeChip = mode === 'clone' && !visitorView ? (
    <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-amber-400/70 bg-amber-50/70 px-2 text-[11px] font-medium text-amber-700 dark:border-amber-700/70 dark:bg-amber-950/30 dark:text-amber-400" data-persona-chip title="persona test — replies as you; your ratings teach it">
      <span className="h-1.5 w-1.5 shrink-0 bg-amber-500 dark:bg-amber-400" aria-hidden />
      <span className="truncate">persona test<span className="hidden lg:inline"> — replies as you; your ratings teach it</span></span>
    </span>
  ) : visitorView ? (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-blue-400/60 bg-blue-50/60 px-2 text-[11px] font-medium text-blue-700 dark:border-blue-700/60 dark:bg-blue-950/30 dark:text-blue-400" data-visitor-chip>
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden />{cloneName}’s persona
    </span>
  ) : null;

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
      tone={mode === 'clone' && !visitorView ? 'persona' : 'neutral'}
      seed={seed}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-chat-view>
      {/* ── Header: one slim hairline row ─────────────────────────── */}
      {!embedded && <header className={
        'relative z-10 flex h-12 shrink-0 items-center gap-2.5 border-b bg-white/85 px-3 backdrop-blur-sm sm:px-4 dark:bg-neutral-950/85 '
        + (mode === 'clone' && !visitorView
            ? 'border-amber-300/70 dark:border-amber-800/60'
            : 'border-neutral-200/80 dark:border-neutral-800/80')
      }>
        <div className="relative shrink-0">
          {mode === 'clone'
            ? <AvatarThumb recipe={avatar} name={cloneName} scale={1.5} state={headState} />
            : <ClaudeGlyph scale={2} state={headState} />}
          <span className={'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-neutral-950 '
              + (connected === 'open' ? 'bg-green-500' : connected === 'connecting' ? 'animate-pulse bg-amber-500' : 'bg-red-500')}
            title={`stream ${connected}`} />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-[13px] font-medium tracking-[-0.01em]">{mode === 'clone' ? cloneName : 'Claude'}</span>
          {modeChip}
          {mode === 'claude' && <span className="hidden text-xs text-neutral-400 md:inline dark:text-neutral-500">learns how you think, automatically</span>}
          {showTitle && (
            <>
              <span className="hidden shrink-0 text-neutral-300 sm:inline dark:text-neutral-700">/</span>
              <div className="min-w-0 flex-1">
                <Title conversationId={conversationId} title={title} canEdit={!readOnly && !visitorView}
                  editing={editingTitle} setEditing={setEditingTitle}
                  onRenamed={(t) => { setTitle(t); router.refresh(); }} />
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {pendingApprovals > 0 && (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-amber-400/70 bg-amber-50 px-2 text-[11px] font-medium text-amber-700 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-400">
              <span className="h-1.5 w-1.5 animate-pulse bg-amber-500" aria-hidden />
              {pendingApprovals} awaiting approval
            </span>
          )}
          {!readOnly && learning && (
            <span className="hidden text-[11px] text-neutral-400 md:inline dark:text-neutral-500" data-learning>
              {learning} — <Link href="/me" className="underline decoration-neutral-300 underline-offset-2 hover:decoration-current dark:decoration-neutral-600">see How I think</Link>
            </span>
          )}
          {!readOnly && !visitorView && (
            <>
              <Link href={newHref ?? '/chat?new=1'} className="icon-btn h-7 w-7" title="New chat" aria-label="New chat" data-new-chat>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </Link>
              <button type="button" className="icon-btn h-7 w-7 hover:text-red-600 dark:hover:text-red-400" title="Delete chat" aria-label="Delete chat" data-delete-chat
                onClick={() => setConfirmingDelete(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
              </button>
              <Link href="/settings#models" className="icon-btn h-7 w-7" title="Pair this machine (bridge)" aria-label="Pair this machine" data-pair-shortcut>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" /></svg>
              </Link>
            </>
          )}
        </div>
      </header>}
      {confirmingDelete && (
        <ConfirmDialog title="Delete this chat?" message="The conversation and its files are removed for good. Memories your persona already learned stay."
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => { await deleteChatAction(conversationId); router.push(newHref ?? '/chat?new=1'); router.refresh(); }} />
      )}

      {/* ── Message canvas: full-bleed scroll, centered reading column ── */}
      <div ref={scrollRef} onScroll={onScroll} className="chat-scroll scroll-touch min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-4 pt-5 sm:px-6">
          {empty && (
            <div className="my-auto flex flex-col items-center gap-5 px-4 py-10 text-center" data-empty-state>
              <div className="hello-rise pixie-float" aria-hidden>
                {mode === 'clone'
                  ? <AvatarThumb recipe={avatar} name={cloneName} scale={3} state="idle" />
                  : <ClaudeGlyph scale={5} state="idle" />}
              </div>
              <div className="hello-rise-2 max-w-md space-y-2">
                <p className="text-lg font-medium tracking-[-0.01em] text-neutral-900 dark:text-neutral-100" suppressHydrationWarning>{greeting}</p>
                <p className="text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {visitorView
                    ? `Ask ${cloneName}'s persona anything — it answers the way ${cloneName} would, from what they chose to share.`
                    : mode === 'clone'
                      ? 'Ask anything — see whether the answer sounds like you. What you type here is never mined for patterns — but your That\u2019s me / Not me ratings do teach your persona.'
                      : 'Say hello. Ask anything, or walk through a problem the way you would — your persona learns from it.'}
                </p>
              </div>
              {!readOnly && (
                <div className="hello-rise-3 flex max-w-lg flex-wrap items-center justify-center gap-2" data-suggestions>
                  {suggestions.map((sugg) => (
                    <button key={sugg} type="button" data-suggestion
                      onClick={() => setSeed({ text: sugg, nonce: Date.now() })}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 shadow-[0_2px_0_0_var(--color-neutral-300)] transition hover:border-amber-400/70 hover:text-neutral-900 hover:shadow-[0_2px_0_0_var(--color-amber-300)] active:translate-y-[2px] active:shadow-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:shadow-[0_2px_0_0_var(--color-neutral-700)] dark:hover:border-amber-500/50 dark:hover:text-neutral-100">
                      {sugg}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'clone' && !visitorView && !readOnly && (
                <p className="text-[11px] text-amber-700/80 dark:text-amber-300/70">It replies as you — rate each answer to teach it.</p>
              )}
            </div>
          )}
          {items.map((it) => {
            switch (it.kind) {
              case 'user':
                return (
                  <div key={it.key} className="mt-6 flex justify-end first:mt-0" data-user-msg>
                    <div className="max-w-[85%] space-y-1.5 rounded-2xl rounded-br-md bg-neutral-100 px-3.5 py-2 text-sm leading-6 text-neutral-900 sm:max-w-[75%] dark:bg-neutral-800/80 dark:text-neutral-100">
                      {it.attachments && it.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {it.attachments.map((a) => a.previewUrl
                            ? <img key={a.id} src={a.previewUrl} alt={a.name} className="h-24 max-w-48 rounded-lg object-cover" />
                            : <span key={a.id} className="chip max-w-60 truncate" title={a.name}>{a.name}</span>)}
                        </div>
                      )}
                      {it.text && <Markdown text={it.text} />}
                    </div>
                  </div>
                );
              case 'assistant':
                return (
                  <div key={it.key} className="group mt-5 first:mt-0" data-assistant-msg>
                    <div className="text-sm leading-[1.7] text-neutral-800 dark:text-neutral-200">
                      <Markdown text={it.text} />
                      {it.streaming && <span className="pixel-cursor ml-1 inline-block h-3.5 w-[6px] bg-amber-500/80 align-middle dark:bg-amber-300/80" data-cursor />}
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
                  <div key={it.key} className="mt-4">
                    <ApprovalCard item={it.approval} canResolve={canResolveApprovals}
                      onResolved={(id, behavior) => apply({ type: 'approval_resolved', id, behavior })} />
                  </div>
                );
              case 'files':
                return <div key={it.key} className="mt-3"><FileChips conversationId={conversationId} files={it.files} /></div>;
              case 'result':
                return (
                  <div key={it.key} className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500" data-result>
                    <span className={it.ok ? '' : 'font-medium text-red-500'}>{it.ok ? 'done' : 'failed'}</span>
                    {showCost && it.cost != null && (<><span aria-hidden className="text-neutral-300 dark:text-neutral-700">·</span>
                      <span title="API-price equivalent — informational on a Claude login, billed only in API-key mode">${it.cost.toFixed(4)}</span></>)}
                    <span aria-hidden className="text-neutral-300 dark:text-neutral-700">·</span><span>{it.input.toLocaleString()} in</span>
                    <span aria-hidden className="text-neutral-300 dark:text-neutral-700">·</span><span>{it.output.toLocaleString()} out</span>
                    <span aria-hidden className="text-neutral-300 dark:text-neutral-700">·</span><span>{it.cacheRead.toLocaleString()} cached</span>
                    {it.error && <span className="text-red-500">{it.error}</span>}
                  </div>
                );
              case 'error':
                return <div key={it.key} className="mt-3 border-l-2 border-red-400 py-0.5 pl-3 text-xs leading-5 text-red-600 dark:border-red-500/70 dark:text-red-400">{it.message}</div>;
              case 'status':
                return (
                  <div key={it.key} className="mt-2 text-[11px] italic text-neutral-400 dark:text-neutral-500">
                    {it.message}{it.attempt != null && it.max != null && ` (attempt ${it.attempt}/${it.max})`}
                  </div>
                );
              case 'system':
                return (
                  <div key={it.key} className="mt-4 flex items-center gap-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                    <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" /><span className="max-w-[70%] text-center">{it.text}</span><span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                  </div>
                );
            }
          })}
          {replying && !items.some((i) => i.kind === 'assistant' && i.streaming) && (
            <div className="mt-5 flex h-6 items-center gap-1.5" data-thinking aria-label="thinking">
              <span className="think-dot inline-block h-1.5 w-1.5 bg-amber-500/70 dark:bg-amber-300/60" />
              <span className="think-dot inline-block h-1.5 w-1.5 bg-amber-500/70 dark:bg-amber-300/60" />
              <span className="think-dot inline-block h-1.5 w-1.5 bg-amber-500/70 dark:bg-amber-300/60" />
            </div>
          )}
          {replying && !items.some((i) => i.kind === 'assistant' && i.streaming) && (
            <div className="mt-1 text-[11px] italic text-neutral-400 dark:text-neutral-500" data-thinking>Thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Composer dock: IN FLOW, fade overlaps the stream ────────── */}
      <div className="relative shrink-0">
        <div className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-t from-white to-transparent dark:from-neutral-950" aria-hidden />
        {readOnly ? (
          <div className="safe-b mx-auto w-full max-w-3xl px-4 pb-4">
            <p className="muted mx-auto w-fit rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2 text-center text-xs dark:border-neutral-800 dark:bg-neutral-900">
              {visitorView ? 'Read-only: this is a colleague’s conversation with your persona — only they can write here.' : 'Read-only: only the persona owner can chat.'}
            </p>
          </div>
        ) : seal && !sealKey ? (
          <div className="safe-b mx-auto w-full max-w-3xl px-4 pb-4">
            <SealUnlock fp={seal} onUnlocked={() => window.location.reload()} />
          </div>
        ) : keyMissing ? (
          <div className="safe-b mx-auto w-full max-w-3xl px-4 pb-4">
            <div className="mx-auto w-full max-w-md rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-center text-sm dark:border-amber-800/60 dark:bg-amber-950/30" data-key-gate>
              {keyMissing === 'mine' ? (
                <>
                  <p className="font-medium">Connect your Claude to start chatting</p>
                  <p className="muted mt-1 text-xs">Two ways: run the <span className="font-medium">opersona bridge</span> on your machine and chats think on the Claude subscription you already have — or add an Anthropic API key. Everything else (building, editing, sharing) already works without either.</p>
                  <Link href="/settings#models" className="btn-primary mt-3 inline-block">Connect in Settings</Link>
                </>
              ) : (
                <>
                  <p className="font-medium">This persona can&apos;t chat yet</p>
                  <p className="muted mt-1 text-xs">Its owner hasn&apos;t connected an Anthropic API key.</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="safe-b mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">{composer}</div>
        )}
      </div>
    </div>
  );
}

/** This device doesn't hold the workspace's seal key: paste the recovery key
 *  (fingerprint-checked locally; the key itself never leaves the browser). */
function SealUnlock({ fp, onUnlocked }: { fp: string; onUnlocked: () => void }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function unlock() {
    setBusy(true); setErr(null);
    const k = val.trim();
    try {
      if ((await sealKeyFingerprint(k)) !== fp) { setErr('That key does not match this workspace.'); setBusy(false); return; }
      storeSealKey(fp, k);
      onUnlocked();
    } catch { setErr('That does not look like a valid key.'); setBusy(false); }
  }
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-sm dark:border-amber-800/60 dark:bg-amber-950/30" data-seal-unlock>
      <p className="font-medium">🔒 Sealed conversations</p>
      <p className="muted mt-1 text-xs">This workspace encrypts chats with a key only you hold. Paste your recovery key to unlock this device — it is checked and stored locally, never sent to the server.</p>
      <div className="mt-2 flex gap-2">
        <input className="input flex-1 font-mono text-xs" type="password" placeholder="your seal key" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void unlock(); }} />
        <button type="button" className="btn-primary" disabled={busy || !val.trim()} onClick={() => void unlock()}>Unlock</button>
      </div>
      {err && <p className="mt-1.5 text-xs text-red-600" role="alert">{err}</p>}
    </div>
  );
}
