'use client';
import { useState } from 'react';

export interface ToolItem { id: string; name: string; input: unknown; ok?: boolean; preview?: string }

export function ToolChip({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const state = item.ok === undefined ? 'running' : item.ok ? 'ok' : 'failed';
  return (
    <div className="my-1">
      <button type="button" className="chip cursor-pointer" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={'inline-block h-1.5 w-1.5 rounded-full ' + (state === 'running' ? 'animate-pulse bg-amber-500' : state === 'ok' ? 'bg-green-500' : 'bg-red-500')} />
        <span className="font-mono">{item.name}</span>
        <span className="muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <div className="muted">input</div>
          <pre className="max-h-40 overflow-auto font-mono">{JSON.stringify(item.input, null, 2)}</pre>
          {item.preview !== undefined && (
            <>
              <div className="muted">result</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono">{item.preview}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
