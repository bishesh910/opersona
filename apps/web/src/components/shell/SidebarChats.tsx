'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { renameConversationAction, deleteChatAction, pinChatAction } from '@/actions/conversations';
import { ConfirmDialog, PromptDialog } from './Dialog';

export interface SidebarChat { id: string; slug: string; title: string; pinned: boolean }

function Item({ c, active }: { c: SidebarChat; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<'delete' | 'rename' | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800';
  return (
    <div ref={ref} className="group relative">
      <Link
        href={`/c/${c.slug}`}
        className={
          'block truncate rounded-md py-1.5 pl-2 pr-7 text-sm ' +
          (active
            ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
            : 'text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60')
        }
        title={c.title}
      >
        {c.pinned && <span aria-hidden className="mr-1 text-[10px]">📌</span>}
        {c.title}
      </Link>
      <button
        type="button"
        aria-label={`Options for ${c.title}`}
        aria-haspopup="menu"
        className={'absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 ' + (open ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100')}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
      >⋮</button>
      {open && (
        <div role="menu" className="card absolute right-0 top-full z-30 mt-1 w-44 p-1 shadow-lg">
          <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" role="menuitem" className={item} onClick={() => setOpen(false)}>Open in new tab</a>
          <button type="button" role="menuitem" className={item} onClick={async () => { setOpen(false); await pinChatAction(c.id, !c.pinned); router.refresh(); }}>{c.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); setDlg('rename'); }}>Rename</button>
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          <button type="button" role="menuitem" className={`${item} text-red-600 dark:text-red-400`} onClick={() => { setOpen(false); setDlg('delete'); }}>Delete</button>
        </div>
      )}
      {dlg === 'delete' && (
        <ConfirmDialog
          title="Delete chat?"
          message={`"${c.title}" will be permanently deleted. This cannot be undone.`}
          busy={busy}
          onCancel={() => setDlg(null)}
          onConfirm={async () => { setBusy(true); await deleteChatAction(c.id); setBusy(false); setDlg(null); if (active) router.push('/chat'); else router.refresh(); }}
        />
      )}
      {dlg === 'rename' && (
        <PromptDialog
          title="Rename chat"
          initial={c.title}
          onCancel={() => setDlg(null)}
          onSubmit={async (t) => { setDlg(null); if (t !== c.title) { await renameConversationAction(c.id, t); router.refresh(); } }}
        />
      )}
    </div>
  );
}

/** Claude-style history: recent conversations under New chat; ⋮ menu per row. */
export function SidebarChats({ items }: { items: SidebarChat[] }) {
  const path = usePathname();
  if (items.length === 0) return null;
  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="muted px-2 pb-1 text-[11px] font-medium uppercase tracking-wide">Chats</div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {items.map((c) => <Item key={c.slug} c={c} active={path === `/c/${c.slug}`} />)}
      </div>
      <Link href="/me/chat" className="muted mt-1 block px-2 py-1 text-xs hover:underline">All chats →</Link>
    </div>
  );
}
