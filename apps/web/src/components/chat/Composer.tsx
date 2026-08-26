'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPT, MAX_FILES, encodeAttachment, fmtSize, rejectReason, toPending, type OutAttachment, type PendingFile } from './attachments';
import { ModelMenu, type EffortValue } from './ModelMenu';

/** What the user bubble needs to show for an attachment (no bytes). */
export interface PendingAttachmentView { id: string; name: string; mime: string; previewUrl?: string }

const MAX_ROWS = 8;

export function Composer({ disabled, replying, model, effort, notice, error, placeholder, onSend, onModel, onEffort, hideModelMenu = false, tone = 'neutral', seed = null }: {
  disabled: boolean; replying: boolean; model: string | null; effort: EffortValue | null; notice: string | null; error: string | null; placeholder: string;
  /** Visitor view: the org default model is used and cannot be changed. */
  hideModelMenu?: boolean;
  /** 'persona' warms the focus/drag ring to amber (clone owner mode). */
  tone?: 'neutral' | 'persona';
  /** Empty-state suggestion → prefill + focus (never submits). nonce lets the same text re-seed. */
  seed?: { text: string; nonce: number } | null;
  onSend: (text: string, attachments: OutAttachment[], views: PendingAttachmentView[]) => Promise<boolean>;
  onModel: (m: string | null) => void; onEffort: (e: EffortValue | null) => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-grow up to ~8 lines.
  const fit = useCallback(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    const line = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    ta.style.height = Math.min(ta.scrollHeight, line * MAX_ROWS + 4) + 'px';
  }, []);
  useEffect(fit, [text, fit]);
  useEffect(() => { if (!disabled) taRef.current?.focus(); }, [disabled]);
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    requestAnimationFrame(() => { fit(); taRef.current?.focus(); });
  }, [seed, fit]);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const errs: string[] = [];
    const ok: File[] = [];
    for (const f of incoming) { const r = rejectReason(f); if (r) errs.push(r); else ok.push(f); }
    setFiles((prev) => {
      const room = MAX_FILES - prev.length;
      if (ok.length > room) errs.push(`Only ${MAX_FILES} files per message`);
      return [...prev, ...toPending(ok.slice(0, Math.max(0, room)))];
    });
    setFileErr(errs.length ? errs.join(' · ') : null);
  }, []);

  const remove = useCallback((id: string) => {
    setFiles((prev) => { const f = prev.find((p) => p.id === id); if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl); return prev.filter((p) => p.id !== id); });
  }, []);

  async function submit() {
    const t = text.trim();
    if (disabled || encoding || (!t && files.length === 0)) return;
    setEncoding(true);
    let out: OutAttachment[];
    try { out = await Promise.all(files.map(encodeAttachment)); }
    catch (e) { setFileErr(e instanceof Error ? e.message : 'Could not read attachment'); setEncoding(false); return; }
    setEncoding(false);
    const views: PendingAttachmentView[] = files.map((f) => ({ id: f.id, name: f.file.name, mime: f.file.type, previewUrl: f.previewUrl }));
    const ok = await onSend(t, out, views);
    if (ok) { setText(''); setFiles([]); setFileErr(null); requestAnimationFrame(fit); }
  }

  function onPaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.files ?? []);
    if (items.length) { e.preventDefault(); addFiles(items); }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const canSend = !disabled && !encoding && (text.trim().length > 0 || files.length > 0);

  const shellTone = dragging
    ? (tone === 'persona'
        ? 'border-amber-400/80 ring-2 ring-amber-200/70 dark:border-amber-500/60 dark:ring-amber-500/20'
        : 'border-neutral-500 ring-2 ring-neutral-300 dark:border-neutral-400 dark:ring-neutral-700')
    : tone === 'persona'
      ? 'border-neutral-200 focus-within:border-amber-400/70 focus-within:ring-2 focus-within:ring-amber-200/60 dark:border-neutral-800 dark:focus-within:border-amber-500/50 dark:focus-within:ring-amber-500/15'
      : 'border-neutral-200 focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-neutral-200 dark:border-neutral-800 dark:focus-within:border-neutral-500 dark:focus-within:ring-neutral-800';

  return (
    <div className="space-y-1" data-composer>
      {(error || fileErr) && <p className="px-2 text-xs text-red-600 dark:text-red-400">{error ?? fileErr}</p>}
      <div
        className={'rounded-2xl border bg-white shadow-lg shadow-neutral-900/5 transition dark:bg-neutral-900 dark:shadow-black/25 ' + shellTone}
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={onDrop}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3" data-pending-attachments>
            {files.map((f) => (
              <div key={f.id} className="group/att relative">
                {f.previewUrl
                  ? <img src={f.previewUrl} alt={f.file.name} className="h-16 w-16 rounded-xl border border-neutral-200 object-cover dark:border-neutral-800" />
                  : (
                    <div className="flex h-16 w-40 flex-col justify-center rounded-xl border border-neutral-200 bg-white px-2.5 dark:border-neutral-800 dark:bg-neutral-950">
                      <div className="truncate text-xs font-medium" title={f.file.name}>{f.file.name}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{(f.file.name.split('.').pop() ?? '').toUpperCase()} · {fmtSize(f.file.size)}</div>
                    </div>
                  )}
                <button type="button" onClick={() => remove(f.id)} aria-label={`Remove ${f.file.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-100">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          className="block w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          rows={1}
          placeholder={replying ? 'Waiting for the reply…' : placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
          disabled={disabled}
          data-composer-input
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-file-input />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={disabled || files.length >= MAX_FILES} title="Attach files or images (or paste / drop them)" aria-label="Attach" data-attach>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>

          {/* keyboard hint: ghost text, only when there is something to send */}
          {text.trim().length > 0 && !replying && (
            <span className="pointer-events-none ml-auto hidden select-none text-[10px] tracking-wide text-neutral-300 sm:inline dark:text-neutral-600" aria-hidden data-kbd-hint>
              <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> new line
            </span>
          )}
          <span className={text.trim().length > 0 && !replying ? '' : 'ml-auto'} />

          {!hideModelMenu && <ModelMenu model={model} effort={effort} disabled={false} onModel={onModel} onEffort={onEffort} />}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label={encoding ? 'Reading attachments…' : 'Send'}
            aria-busy={encoding || undefined}
            title="Send (Enter)"
            data-send-btn
            data-send
            className={'send-disc grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:cursor-not-allowed '
              + (canSend
                ? 'bg-neutral-900 text-white shadow-sm hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white'
                : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600')}
          >
            {encoding
              ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
          </button>
        </div>
      </div>
      {notice && <p className="muted px-2 text-[11px]" data-notice>{notice}</p>}
    </div>
  );
}
