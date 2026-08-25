'use client';
import { useEffect, useRef, useState } from 'react';
import { askPersonaAction } from '@/actions/conversations';

export interface PersonaOption { cloneId: string; name: string; mine: boolean }

/** "Talk to persona" under New chat: searchable list of the org's personas. */
export function TalkToPersona({ options }: { options: PersonaOption[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const hits = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="block w-full rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQ(''); }}
      >
        Talk to persona
      </button>
      {open && (
        <div role="menu" className="card absolute inset-x-0 top-full z-30 mt-1 p-2 shadow-lg">
          <input autoFocus className="input mb-1.5" placeholder="Who?" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-56 overflow-y-auto">
            {hits.length === 0 && <p className="muted px-2 py-1.5 text-xs">No persona matches.</p>}
            {hits.map((o) => (
              <form key={o.cloneId} action={askPersonaAction}>
                <input type="hidden" name="cloneId" value={o.cloneId} />
                <button type="submit" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  <span aria-hidden className={'inline-block h-2 w-2 rounded-full ' + (o.mine ? 'bg-amber-500' : 'bg-violet-500')} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.mine && <span className="muted text-[11px]">you · test</span>}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
