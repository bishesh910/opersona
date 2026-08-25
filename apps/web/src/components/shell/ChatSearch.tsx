'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Hit { slug: string; title: string; when: string }

export function ChatSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/chat-search?q=${encodeURIComponent(q)}`);
        const j = (await r.json()) as { results?: Hit[] };
        setHits(j.results ?? []);
      } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Search chats" className="icon-btn rounded-md p-1.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" onClick={() => { setOpen((o) => !o); setQ(''); setHits([]); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      </button>
      {open && (
        <div className="card absolute bottom-full left-0 z-20 mb-2 w-72 p-2 shadow-lg">
          <input autoFocus className="input" placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-1.5 max-h-64 overflow-y-auto">
            {busy && <p className="muted px-2 py-1 text-xs">Searching…</p>}
            {!busy && q.trim().length >= 2 && hits.length === 0 && <p className="muted px-2 py-1 text-xs">Nothing found.</p>}
            {hits.map((h) => (
              <Link key={h.slug} href={`/c/${h.slug}`} onClick={() => setOpen(false)} className="block rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <span className="block truncate">{h.title}</span>
                <span className="muted block text-[11px]">{h.when}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
