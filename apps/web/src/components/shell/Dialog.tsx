'use client';
import { useEffect, useRef, useState } from 'react';

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        {children}
      </div>
    </div>
  );
}

/** In-app confirm — never window.confirm. */
export function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, busy = false, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Overlay onClose={onCancel}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="muted mt-1 text-sm">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          autoFocus
          className={danger ? 'rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60' : 'btn-primary'}
          onClick={onConfirm}
          disabled={busy}
        >{busy ? '…' : confirmLabel}</button>
      </div>
    </Overlay>
  );
}

/** In-app text prompt — never window.prompt. */
export function PromptDialog({ title, initial = '', submitLabel = 'Save', placeholder, onSubmit, onCancel }: {
  title: string; initial?: string; submitLabel?: string; placeholder?: string; onSubmit: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.select(); }, []);
  const submit = () => { const v = value.trim(); if (v) onSubmit(v); };
  return (
    <Overlay onClose={onCancel}>
      <h2 className="text-base font-semibold">{title}</h2>
      <input
        ref={inputRef}
        autoFocus
        className="input mt-3"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={!value.trim()}>{submitLabel}</button>
      </div>
    </Overlay>
  );
}
