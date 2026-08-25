'use client';
import { useEffect, useRef, useState } from 'react';
import { askPersonaAction } from '@/actions/conversations';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import type { AvatarRecipe } from '@opersona/shared';

export interface PersonaOption { cloneId: string; name: string; mine: boolean; recipe?: AvatarRecipe | null }

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
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQ(''); }}
      >
        <span className="opacity-70" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.6 3v-3A2.5 2.5 0 0 1 4 10.5v-4Z" /><path d="M19.8 9.5c.7.4 1.2 1.2 1.2 2.1v3.4c0 1.1-.9 2-2 2v2.4l-2.9-2.4h-3" /></svg>
        </span>
        Talk to opersona
      </button>
      {open && (
        <div role="menu" className="card absolute left-full top-0 z-30 ml-2 w-64 p-2 shadow-lg">
          <input autoFocus className="input mb-1.5" placeholder="Who?" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-56 overflow-y-auto">
            {hits.length === 0 && <p className="muted px-2 py-1.5 text-xs">No persona matches.</p>}
            {hits.map((o) => (
              <form key={o.cloneId} action={askPersonaAction}>
                <input type="hidden" name="cloneId" value={o.cloneId} />
                <button type="submit" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  <AvatarThumb recipe={o.recipe} name={o.name} scale={1} />
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
