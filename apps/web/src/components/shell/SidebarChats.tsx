'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SidebarChat { slug: string; title: string }

/** Claude-style history: recent conversations under New chat, active one highlighted. */
export function SidebarChats({ items }: { items: SidebarChat[] }) {
  const path = usePathname();
  if (items.length === 0) return null;
  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="muted px-2 pb-1 text-[11px] font-medium uppercase tracking-wide">Chats</div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {items.map((c) => {
          const active = path === `/c/${c.slug}`;
          return (
            <li key={c.slug}>
              <Link
                href={`/c/${c.slug}`}
                className={
                  'block truncate rounded-md px-2 py-1.5 text-sm ' +
                  (active
                    ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
                    : 'text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60')
                }
                title={c.title}
              >
                {c.title}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/me/chat" className="muted mt-1 block px-2 py-1 text-xs hover:underline">All chats →</Link>
    </div>
  );
}
