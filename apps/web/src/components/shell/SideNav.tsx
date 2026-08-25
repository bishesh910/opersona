'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/chat', label: 'New chat' },
  { href: '/me', label: 'My persona' },
  { href: '/clones', label: 'Personas' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/settings', label: 'Settings' },
];

export function SideNav({ horizontal = false }: { horizontal?: boolean }) {
  const path = usePathname();
  return (
    <ul className={horizontal ? 'nav-scroll gap-1' : 'space-y-0.5'}>
      {ITEMS.map((it) => {
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
