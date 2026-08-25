'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface RecentChat { slug: string; title: string; when: string }

/** "chats ▾" — the 5 most recent conversations, then All chats. */
export function RecentChats({ items, currentSlug, variant = 'inline' }: { items: RecentChat[]; currentSlug: string; variant?: 'inline' | 'strip' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className={variant === 'strip'
          ? 'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300'
          : 'muted text-xs hover:underline'}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {variant === 'strip' && (
          <span className="opacity-70" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l2.5 2.5" /><circle cx="12" cy="12" r="8.5" /></svg>
          </span>
        )}
        {variant === 'strip' ? 'Chats ▾' : 'chats ▾'}
      </button>
      {open && (
        <div role="menu" className={"card absolute z-20 mt-1 w-64 p-1.5 shadow-lg " + (variant === "strip" ? "right-0" : "left-0")}>
          {items.filter((c) => c.slug !== currentSlug).slice(0, 5).map((c) => (
            <Link key={c.slug} href={`/c/${c.slug}`} role="menuitem" onClick={() => setOpen(false)}
              className="block rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <span className="block truncate">{c.title}</span>
              <span className="muted block text-[11px]">{c.when}</span>
            </Link>
          ))}
          {items.filter((c) => c.slug !== currentSlug).length === 0 && <p className="muted px-2 py-1.5 text-xs">No other chats yet.</p>}
          <div className="mt-1 border-t border-neutral-200 pt-1 dark:border-neutral-800">
            <Link href="/me/chat" role="menuitem" onClick={() => setOpen(false)} className="block rounded px-2 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800">All chats →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
