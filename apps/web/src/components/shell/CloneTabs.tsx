'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

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
  const router = useRouter();
  const hrefFor = (t: { key: string }) => {
    const short = t.key === 'documents' ? 'docs' : t.key;
    return isOwner ? (t.key === 'thinking' ? '/me' : `/me/${short}`) : `/clones/${cloneId}/${t.key}`;
  };
  const isActive = (t: { key: string }) => {
    const href = hrefFor(t);
    return t.key === 'thinking'
      ? path === href || path === '/me/thinking' || path === `/clones/${cloneId}/thinking`
      : path === href || path.startsWith(href + '/') || (t.key === 'chat' && path.startsWith('/c/'));
  };
  const current = TABS.find(isActive)?.key ?? 'thinking';
  return (
    <>
    {/* phones: native picker (iOS wheel) instead of a sliding tab strip */}
    <div className="py-1 md:hidden">
      <select
        aria-label="Persona section"
        className="input w-full font-medium"
        value={current}
        onChange={(e) => { const t = TABS.find((x) => x.key === e.target.value); if (t) router.push(hrefFor(t)); }}
      >
        {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
    </div>
    <div className="hidden md:block">
    <div className="nav-scroll gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {TABS.map((t) => {
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
