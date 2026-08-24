'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: { key: string; label: string }[] = [
  { key: 'brief', label: 'Brief' },
  { key: 'thinking', label: 'How I think' },
  { key: 'personality', label: 'Personality' },
  { key: 'survey', label: 'Survey' },
  { key: 'avatar', label: 'Avatar' },
  { key: 'chat', label: 'Chat' },
  { key: 'memory', label: 'Memory' },
  { key: 'documents', label: 'Documents' },
];

export function CloneTabs({ cloneId, isOwner = false }: { cloneId: string; isOwner?: boolean }) {
  const path = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
      {TABS.map((t) => {
        const short = t.key === 'documents' ? 'docs' : t.key;
        const href = isOwner ? (t.key === 'thinking' ? '/me' : `/me/${short}`) : `/clones/${cloneId}/${t.key}`;
        // '/me' is a prefix of every short URL, so the thinking tab matches exactly; the rest keep prefix matching.
        const active = t.key === 'thinking'
          ? path === href || path === '/me/thinking' || path === `/clones/${cloneId}/thinking`
          : path === href || path.startsWith(href + '/') || (t.key === 'chat' && path.startsWith('/c/'));
        return (
          <Link
            key={t.key}
            href={href}
            className={
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ' +
              (active
                ? 'border-neutral-900 font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
