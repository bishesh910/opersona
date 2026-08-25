'use client';
import { useState } from 'react';

export interface ToolItem { id: string; name: string; input: unknown; ok?: boolean; preview?: string }

/** Raw tool ids → quiet human verbs. Unknown tools fall back to a cleaned name. */
function label(name: string, running: boolean): string {
  const map: Record<string, [string, string]> = {
    mcp__persona__recall_memory: ['remembering…', 'remembered'],
    mcp__persona__search_documents: ['searching documents…', 'searched documents'],
    mcp__persona__get_playbook: ['opening playbook…', 'opened playbook'],
    mcp__persona__ask_human: ['asking you…', 'asked you'],
    WebSearch: ['searching the web…', 'searched the web'],
    Read: ['reading…', 'read a file'],
    Glob: ['looking around…', 'looked around'],
    Grep: ['searching files…', 'searched files'],
  };
  const m = map[name];
  if (m) return running ? m[0] : m[1];
  const clean = name.replace(/^mcp__[^_]+__/, '').replace(/_/g, ' ');
  return running ? clean + '…' : clean;
}

export function ToolChip({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const state = item.ok === undefined ? 'running' : item.ok ? 'ok' : 'failed';
  return (
    <div className="my-1">
      <button
        type="button"
        className={'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-opacity ' + (state === 'failed' ? 'text-red-500 opacity-80' : 'text-neutral-400 opacity-60 hover:opacity-100 dark:text-neutral-500')}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={item.name}
      >
        <span className={'inline-block h-1 w-1 rounded-full ' + (state === 'running' ? 'animate-pulse bg-amber-500' : state === 'ok' ? 'bg-neutral-400 dark:bg-neutral-600' : 'bg-red-500')} />
        <span className="italic">{label(item.name, state === 'running')}</span>
        <span>{open ? '▾' : '▸'}</span>
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
