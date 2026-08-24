'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACCEPT, MAX_FILES, encodeAttachment, fmtSize, rejectReason, toPending, type OutAttachment, type PendingFile } from './attachments';
import { ModelMenu, type EffortValue } from './ModelMenu';

/** What the user bubble needs to show for an attachment (no bytes). */
export interface PendingAttachmentView { id: string; name: string; mime: string; previewUrl?: string }

const MAX_ROWS = 8;

export function Composer({ disabled, replying, model, effort, notice, error, placeholder, onSend, onModel, onEffort, hideModelMenu = false }: {
  disabled: boolean; replying: boolean; model: string | null; effort: EffortValue | null; notice: string | null; error: string | null; placeholder: string;
  /** Visitor view: the org default model is used and cannot be changed. */
  hideModelMenu?: boolean;
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

  return (
    <div className="space-y-1" data-composer>
      {(error || fileErr) && <p className="px-1 text-xs text-red-600">{error ?? fileErr}</p>}
      <div
        className={
          'rounded-md border bg-white shadow-xs transition dark:bg-neutral-900 ' +
          (dragging ? 'border-neutral-500 ring-2 ring-neutral-300 dark:ring-neutral-700' : 'border-neutral-300 focus-within:border-neutral-500 focus-within:ring-2 focus-within:ring-neutral-300 dark:border-neutral-700 dark:focus-within:border-neutral-400 dark:focus-within:ring-neutral-700')
        }
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={onDrop}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3" data-pending-attachments>
            {files.map((f) => (
              <div key={f.id} className="group/att relative">
                {f.previewUrl
                  ? <img src={f.previewUrl} alt={f.file.name} className="h-16 w-16 rounded-lg border border-neutral-200 object-cover dark:border-neutral-800" />
                  : (
                    <div className="flex h-16 w-40 flex-col justify-center rounded-lg border border-neutral-200 bg-white px-2.5 dark:border-neutral-800 dark:bg-neutral-950">
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
          className="block w-full resize-none bg-transparent px-2.5 pt-2 pb-1 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          rows={1}
          placeholder={replying ? 'Waiting for the reply…' : placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
          disabled={disabled}
          data-composer-input
        />
        <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
          <div className="flex items-center gap-1">
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-file-input />
            <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={disabled || files.length >= MAX_FILES} title="Attach files or images (or paste / drop them)" aria-label="Attach" data-attach>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {!hideModelMenu && <ModelMenu model={model} effort={effort} disabled={false} onModel={onModel} onEffort={onEffort} />}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              className="btn-primary btn-sm"
              data-send-btn
              aria-label="Send"
              title="Send (Enter)"
              data-send
            >
              {encoding ? 'Reading…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
      {notice && <p className="muted px-1 text-[11px]" data-notice>{notice}</p>}
    </div>
  );
}
