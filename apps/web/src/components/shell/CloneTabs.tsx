'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const TABS: { key: string; label: string }[] = [
  { key: 'brief', label: 'Brief' },
  { key: 'thinking', label: 'How I think' },
  { key: 'personality', label: 'Personality' },
  { key: 'survey', label: 'Test me' },
  { key: 'simulate', label: 'Simulate' },
  { key: 'avatar', label: 'Pixie' },
  { key: 'memory', label: 'Memory' },
  { key: 'documents', label: 'Documents' },
  { key: 'share', label: 'Share' },
];

/** Imported copies are read-mostly: no survey/memory/docs/share — they never learn. */
const IMPORTED_TABS = new Set(['brief', 'thinking', 'personality', 'avatar']);

/** Tabs with chat/learning content are the owner's alone — colleagues and admins see
 *  only the persona-identity tabs (privacy: the system enforces it, nobody "watches"). */
const PUBLIC_TABS = new Set(['brief', 'thinking', 'personality', 'avatar', 'documents']);

export function CloneTabs({ cloneId, isOwner = false, kind = 'member' }: { cloneId: string; isOwner?: boolean; kind?: 'member' | 'hired' | 'imported' }) {
  const path = usePathname();
  const router = useRouter();
  const visible = kind === 'imported'
    ? TABS.filter((t) => IMPORTED_TABS.has(t.key))
    : isOwner ? TABS : TABS.filter((t) => PUBLIC_TABS.has(t.key));
  const hrefFor = (t: { key: string }) => {
    const short = t.key === 'documents' ? 'docs' : t.key;
    return isOwner && kind === 'member' ? (t.key === 'thinking' ? '/me' : `/me/${short}`) : `/opersonas/${cloneId}/${t.key}`;
  };
  const isActive = (t: { key: string }) => {
    const href = hrefFor(t);
    return t.key === 'thinking'
      ? path === href || path === '/me/thinking' || path === `/opersonas/${cloneId}/thinking`
      : path === href || path.startsWith(href + '/');
  };
  const current = TABS.find(isActive)?.key ?? 'thinking';
  return (
    <>
    {/* phones: every section visible as a pill — nothing hidden behind a popup */}
    <div className="flex flex-wrap gap-1.5 py-1 md:hidden" role="tablist" aria-label="Persona sections">
      {visible.map((t) => {
        const active = isActive(t);
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => router.push(hrefFor(t))}
            className={
              'rounded-full border px-3 py-1.5 text-sm transition-colors ' +
              (active
                ? 'border-neutral-900 bg-neutral-900 font-medium text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300')
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
    <div className="hidden md:block">
    <div className="nav-scroll gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {visible.map((t) => {
        const href = hrefFor(t);
        const active = isActive(t);
        return (
          <Link
            key={t.key}
            href={href}
            className={
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ' +
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
    </div>
    </>
  );
}
