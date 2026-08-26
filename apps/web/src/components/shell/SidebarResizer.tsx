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

export function SidebarResizer() {
  const drag = useRef<{ startX: number; startW: number; moved: boolean } | null>(null);
  const lastW = useRef(DEF);

  const collapsed = () => document.documentElement.hasAttribute('data-sb-collapsed');

  function toggle() {
    const el = document.documentElement;
    if (collapsed()) {
      el.removeAttribute('data-sb-collapsed');
      setWidth(lastW.current);
      persist(lastW.current, false);
    } else {
      lastW.current = currentWidth();
      el.setAttribute('data-sb-collapsed', '');
      setWidth(0);
      persist(lastW.current, true);
    }
  }

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
        if (!d.moved) { toggle(); return; }
        if (!collapsed()) { lastW.current = currentWidth(); persist(lastW.current, false); }
      }}
    >
      {/* hover/focus indicator */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-full bg-transparent transition-colors group-hover:bg-neutral-300/70 group-focus-visible:bg-neutral-300/70 dark:group-hover:bg-neutral-700/80 dark:group-focus-visible:bg-neutral-700/80" />
    </button>
  );
}
