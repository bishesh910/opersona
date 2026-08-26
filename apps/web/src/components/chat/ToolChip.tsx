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
    mcp__persona__ask_colleague: ['asking a colleague’s persona…', 'asked a colleague’s persona'],
    WebSearch: ['searching the web…', 'searched the web'],
    Read: ['reading…', 'read a file'],
    Glob: ['looking around…', 'looked around'],
    Grep: ['searching files…', 'searched files'],
    Bash: ['running code…', 'ran code'],
    Write: ['writing a file…', 'wrote a file'],
    Edit: ['editing a file…', 'edited a file'],
  };
  const m = map[name];
  if (m) return running ? m[0] : m[1];
  const clean = name.replace(/^mcp__[^_]+__/, '').replace(/_/g, ' ');
  return running ? clean + '…' : clean;
}

/** Tool activity as a quiet micro-timeline row; expands to input/result. */
export function ToolChip({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const state = item.ok === undefined ? 'running' : item.ok ? 'ok' : 'failed';
  return (
    <div className="mb-1 mt-0.5" data-tool>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={item.name}
        className={'group -mx-1 flex h-6 items-center gap-2 rounded-md px-1 text-left font-mono text-[11px] transition '
          + (state === 'failed'
            ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
            : 'text-neutral-400 hover:bg-neutral-100/70 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800/50 dark:hover:text-neutral-300')}
      >
        <span className={'h-[5px] w-[5px] shrink-0 '
          + (state === 'running' ? 'animate-pulse bg-amber-500' : state === 'ok' ? 'bg-neutral-300 dark:bg-neutral-600' : 'bg-red-500')} />
        <span>{label(item.name, state === 'running')}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={'shrink-0 opacity-0 transition group-hover:opacity-100 ' + (open ? 'rotate-90 opacity-100' : '')}><path d="M9 6l6 6-6 6" /></svg>
      </button>
      {open && (
        <div className="ml-[1px] mt-1 space-y-2 border-l border-neutral-200 py-1 pl-4 dark:border-neutral-800">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">input</div>
            <pre className="max-h-44 overflow-auto rounded-md bg-neutral-50 p-2 font-mono text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">{JSON.stringify(item.input, null, 2)}</pre>
          </div>
          {item.preview !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">result</div>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-2 font-mono text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">{item.preview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
