'use client';
import { useRef } from 'react';

/**
 * The thin strip between the sidebar and the content: DRAG to resize the
 * sidebar (180–400px), CLICK to collapse/expand it. Width and collapsed state
 * persist in localStorage; a pre-paint script in the app layout applies them
 * before first paint so there's no flash.
 */
const MIN = 180, MAX = 400, DEF = 224;
const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n));

function currentWidth(): number {
  const v = document.documentElement.style.getPropertyValue('--sb-w');
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEF;
}
function setWidth(px: number) {
  document.documentElement.style.setProperty('--sb-w', `${px}px`);
}
function persist(width: number, collapsed: boolean) {
  try {
    localStorage.setItem('sb.w', String(width));
    localStorage.setItem('sb.collapsed', collapsed ? '1' : '0');
  } catch { /* private mode */ }
}

const collapsed = () => document.documentElement.hasAttribute('data-sb-collapsed');

/** Collapse ⇄ expand, remembering the last width in localStorage. */
export function toggleSidebar() {
  const el = document.documentElement;
  if (collapsed()) {
    let w = DEF;
    try { const n = parseInt(localStorage.getItem('sb.w') ?? '', 10); if (n >= MIN && n <= MAX) w = n; } catch { /* ok */ }
    el.removeAttribute('data-sb-collapsed');
    setWidth(w);
    persist(w, false);
  } else {
    const w = currentWidth();
    el.setAttribute('data-sb-collapsed', '');
    setWidth(0);
    persist(w, true);
  }
}

export function SidebarResizer() {
  const drag = useRef<{ startX: number; startW: number; moved: boolean } | null>(null);

  return (
    <button
      type="button"
      aria-label="Sidebar: drag to resize, click to collapse"
      title="Drag to resize · Click to collapse"
      className="group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none border-0 bg-transparent p-0 outline-none md:block"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startW: collapsed() ? 0 : currentWidth(), moved: false };
        document.documentElement.setAttribute('data-sb-drag', '');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        if (Math.abs(dx) > 3) d.moved = true;
        if (!d.moved) return;
        // dragging out of a collapsed sidebar re-opens it
        if (collapsed() && dx > 3) document.documentElement.removeAttribute('data-sb-collapsed');
        if (!collapsed()) setWidth(clamp((d.startW || DEF) + dx));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        document.documentElement.removeAttribute('data-sb-drag');
        if (!d) return;
        if (!d.moved) { toggleSidebar(); return; }
        if (!collapsed()) persist(currentWidth(), false);
      }}
    >
      {/* hover/focus indicator */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-full bg-transparent transition-colors group-hover:bg-neutral-300/70 group-focus-visible:bg-neutral-300/70 dark:group-hover:bg-neutral-700/80 dark:group-focus-visible:bg-neutral-700/80" />
    </button>
  );
}

/** The visible affordance: a « button in the sidebar header, and a floating »
 *  button pinned top-left while collapsed (fixed position escapes the collapsed
 *  aside's clipping). Visibility is CSS-gated on html[data-sb-collapsed]. */
export function SidebarToggle() {
  return (
    <>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
        className="sb-when-open absolute right-2 top-3.5 hidden h-7 w-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-700 md:grid dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m11 17-5-5 5-5M18 17l-5-5 5-5" /></svg>
      </button>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Expand sidebar"
        title="Expand sidebar"
        className="sb-when-collapsed fixed left-2 top-3 z-30 hidden h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white/90 text-neutral-500 shadow-sm backdrop-blur transition-colors hover:text-neutral-800 md:grid dark:border-neutral-700 dark:bg-neutral-900/90 dark:hover:text-neutral-200"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 7 5 5-5 5M13 7l5 5-5 5" /></svg>
      </button>
    </>
  );
}
