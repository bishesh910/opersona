'use client';
/**
 * Office shell — the munder-difflin App.tsx layout, opersona-flavoured:
 * floor on the left, a draggable splitter, the persona panel on the right,
 * and a roster strip along the bottom (click a card → select + camera nudge).
 * On phones the panel becomes a slide-up sheet.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OfficeFloor, type FloorMember } from '@/office/OfficeFloor';
import { setBossAction } from '@/actions/office';
import { PersonaPanel, type PanelMember } from './PersonaPanel';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';

const MIN_W = 300, MAX_W = 560, DEF_W = 380;

export function OfficeShell({ members, canStar = false, bossCloneId = null }: { members: PanelMember[]; canStar?: boolean; bossCloneId?: string | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [starErr, setStarErr] = useState<string | null>(null);
  const star = (cloneId: string): void => {
    startTransition(async () => {
      try { setStarErr(null); await setBossAction(cloneId === bossCloneId ? null : cloneId); router.refresh(); }
      catch (e) { setStarErr(e instanceof Error ? e.message : 'Could not set the boss'); }
    });
  };
  const [panelW, setPanelW] = useState(DEF_W);
  const dragRef = useRef<{ x: number; w: number; cur: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape deselects (closes panel/sheet)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSelected(null); };
    // a boss hire/archive changes the floor roster — pull fresh members
    const onToolResult = (e: Event): void => {
      const d = (e as CustomEvent<{ name?: string }>).detail;
      if (d?.name?.endsWith('hire_persona') || d?.name?.endsWith('archive_persona')) router.refresh();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('opersona:tool-result', onToolResult);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('opersona:tool-result', onToolResult); };
  }, [router]);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem('office.panelW') ?? '', 10); if (n >= MIN_W && n <= MAX_W) setPanelW(n); } catch { /* ok */ }
  }, []);

  const floorMembers: FloorMember[] = members.map((m) => ({ id: m.key, name: m.name, recipe: m.recipe, boss: m.boss }));
  const sel = members.find((m) => m.key === selected) ?? null;
  const onSelect = useCallback((id: string | null) => setSelected(id), []);

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-2">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <OfficeFloor members={floorMembers} selectedId={selected} onSelect={onSelect} />
        </div>
        {/* splitter + panel — desktop only; phones get the sheet below */}
        <button
          type="button"
          aria-label="Resize panel"
          className="mx-1 hidden w-1.5 shrink-0 cursor-col-resize rounded bg-transparent transition-colors hover:bg-neutral-300/70 md:block dark:hover:bg-neutral-700"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, w: panelW, cur: panelW };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            // width via style during the drag — one React commit on release, no canvas churn
            d.cur = Math.max(MIN_W, Math.min(MAX_W, d.w - (e.clientX - d.x)));
            if (panelRef.current) panelRef.current.style.width = `${d.cur}px`;
          }}
          onPointerUp={() => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d) return;
            setPanelW(d.cur);
            try { localStorage.setItem('office.panelW', String(d.cur)); } catch { /* ok */ }
          }}
          onDoubleClick={() => setPanelW(DEF_W)}
        />
        <div ref={panelRef} className="hidden shrink-0 md:block" style={{ width: panelW }}>
          <PersonaPanel key={sel?.key ?? "none"} member={sel} total={members.length} onClose={() => setSelected(null)} noBossHint={canStar && !bossCloneId} />
        </div>
      </div>
      {starErr && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{starErr}</p>}
      {/* roster strip */}
      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" aria-label="Colleagues">
        {members.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={m.key === selected}
            onClick={() => setSelected(m.key === selected ? null : m.key)}
            className={'flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors '
              + (m.key === selected
                ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/30'
                : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600')}
          >
            <AvatarThumb recipe={m.recipe} name={m.name} scale={1} />
            <span className="min-w-0">
              <span className="block max-w-28 truncate text-xs font-medium">{m.name}</span>
              <span className="muted block max-w-28 truncate text-[10px]">{m.hired ? 'hired' : m.role || (m.id ? 'persona' : 'no persona yet')}</span>
            </span>
            {m.id && (canStar || m.boss) && (
              <span
                role={canStar ? 'button' : undefined}
                aria-label={canStar ? (m.boss ? `Remove ${m.name} as boss` : `Make ${m.name} the boss`) : `${m.name} is the boss`}
                title={canStar ? 'The boss runs the floor: delegates work, hires specialists' : 'Office boss'}
                onClick={canStar ? (e) => { e.stopPropagation(); star(m.id!); } : undefined}
                className={'ml-0.5 text-sm leading-none transition-colors ' + (m.boss ? 'text-amber-500' : !bossCloneId && canStar ? 'animate-pulse text-amber-300 hover:text-amber-500 dark:text-amber-700' : 'text-neutral-300 hover:text-amber-400 dark:text-neutral-600')}
              >★</span>
            )}
          </button>
        ))}
      </div>
      {/* phone: slide-up sheet */}
      {sel && (
        <>
          <button type="button" aria-label="Close panel" className="fixed inset-0 z-20 bg-black/25 md:hidden" onClick={() => setSelected(null)} />
          <div role="dialog" aria-modal="true" aria-label={`${sel.name} persona`} className="fixed inset-x-0 bottom-0 z-30 h-[78dvh] rounded-t-2xl border-t border-neutral-200 bg-white p-1 shadow-2xl md:hidden dark:border-neutral-700 dark:bg-neutral-900">
            <PersonaPanel key={sel.key} member={sel} total={members.length} onClose={() => setSelected(null)} />
          </div>
        </>
      )}
    </div>
  );
}
