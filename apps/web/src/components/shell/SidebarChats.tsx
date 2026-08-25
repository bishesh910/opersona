'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { renameConversationAction, deleteChatAction, pinChatAction } from '@/actions/conversations';
import { ConfirmDialog, PromptDialog } from './Dialog';

export interface SidebarChat { id: string; slug: string; title: string; pinned: boolean; href: string; mode: 'claude' | 'clone'; mine: boolean; personaName?: string }

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
        href={c.href}
        className={
          'block truncate rounded-md py-1.5 pl-2 pr-7 text-sm ' +
          (active
            ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
            : 'text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60')
        }
        title={c.title}
      >
        {!c.mine && c.personaName ? `${c.personaName} · ${c.title}` : c.title}
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
          <a href={c.href} target="_blank" rel="noreferrer" role="menuitem" className={item} onClick={() => setOpen(false)}>Open in new tab</a>
          <button type="button" role="menuitem" className={item} onClick={async () => { setOpen(false); await pinChatAction(c.id, !c.pinned); router.refresh(); }}>{c.pinned ? 'Unpin' : 'Pin'}</button>
          {c.mine && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); setDlg('rename'); }}>Rename</button>}
          {c.mine && (
            <>
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
              <button type="button" role="menuitem" className={`${item} text-red-600 dark:text-red-400`} onClick={() => { setOpen(false); setDlg('delete'); }}>Delete</button>
            </>
          )}
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

function Section({ label, storageKey, chats, path, first }: { label: string; storageKey: string; chats: SidebarChat[]; path: string; first: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(storageKey) === '0') setOpen(false); } catch { /* ignore */ } }, [storageKey]);
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(storageKey, o ? '0' : '1'); } catch { /* ignore */ } return !o; }); };
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={'muted flex w-full items-center gap-1.5 px-2 pb-1 text-xs font-medium hover:text-neutral-700 dark:hover:text-neutral-300 ' + (first ? '' : 'mt-4')}
      >
        {label}
        <span aria-hidden className={'text-sm leading-none ' + (open ? '' : 'opacity-50')}>›</span>
        {!open && <span className="ml-auto">{chats.length}</span>}
      </button>
      {open && <div className="space-y-0.5">{chats.map((c) => <Item key={c.id} c={c} active={path === c.href} />)}</div>}
    </>
  );
}

/** Claude-style history in two collapsible sections: plain Claude chats, then persona chats. */
export function SidebarChats({ items }: { items: SidebarChat[] }) {
  const path = usePathname();
  if (items.length === 0) return null;
  const pinned = items.filter((c) => c.pinned);
  const claude = items.filter((c) => !c.pinned && c.mode === 'claude');
  const persona = items.filter((c) => !c.pinned && c.mode === 'clone');
  let first = true;
  const takeFirst = () => { const f = first; first = false; return f; };
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {pinned.length > 0 && <Section label="Pinned" storageKey="sb.pinned" chats={pinned} path={path} first={takeFirst()} />}
        {claude.length > 0 && <Section label="Chats" storageKey="sb.chats" chats={claude} path={path} first={takeFirst()} />}
        {persona.length > 0 && <Section label="opersona chats" storageKey="sb.pchats" chats={persona} path={path} first={takeFirst()} />}
      </div>
      <Link href="/me/chat" className="muted mt-1 block px-2 py-1 text-xs hover:underline">All chats →</Link>
    </div>
  );
}
