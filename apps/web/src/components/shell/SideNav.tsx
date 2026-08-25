'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/chat', label: 'New chat' },
  { href: '/me', label: 'Me' },
  { href: '/clones', label: 'opersonas' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/settings', label: 'Settings' },
];

const LEAN = new Set(['/chat', '/approvals']); // desktop sidebar: the rest live in the account menu

export function SideNav({ horizontal = false, include }: { horizontal?: boolean; include?: string[] }) {
  const path = usePathname();
  const items = horizontal ? ITEMS : ITEMS.filter((it) => (include ? include.includes(it.href) : LEAN.has(it.href)));
  return (
    <ul className={horizontal ? 'nav-scroll gap-1' : 'space-y-0.5'}>
      {items.map((it, idx) => {
        const active = path === it.href || path.startsWith(it.href + '/');
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              className={
                'block whitespace-nowrap rounded-md px-3 py-2 text-sm ' +
                (active
                  ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
                  : 'text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60')
              }
            >
              {it.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
