'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { ThemeToggle } from './ThemeToggle';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import type { AvatarRecipe } from '@opersona/shared';

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('') || '?';

export function UserMenu({ name, email, avatarRecipe, dropUp = false, compact = false }: { name: string; email: string; avatarRecipe?: AvatarRecipe | null; dropUp?: boolean; compact?: boolean }) {
  const [pop, setPop] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className={compact ? "static" : "relative"}>
      <button
        type="button"
        className={compact
          ? 'flex items-center justify-center rounded-lg p-1 transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-800'
          : 'flex items-center gap-2 rounded-lg border border-neutral-200 py-1 pl-1 pr-2.5 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800/60'}
        onClick={() => { setOpen((o) => !o); setPop((n) => n + 1); }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
      >
        <span key={pop} className={pop ? 'pixie-pop inline-block' : 'inline-block'}>
          <AvatarThumb recipe={avatarRecipe} name={name} scale={1.5} />
        </span>
        {!compact && <span className="hidden sm:inline">{initials(name)}</span>}
      </button>
      {open && (
        <div role="menu" className={"card absolute z-20 w-56 p-2 shadow-lg " + (dropUp ? (compact ? "bottom-full inset-x-0 mb-2" : "bottom-full left-0 mb-1") : "right-0 mt-1")}>
          <div className="px-2 py-1 text-xs">
            <div className="font-medium">{name}</div>
            <div className="muted truncate">{email}</div>
          </div>
          <nav className="mt-1 border-t border-neutral-200 pt-1 dark:border-neutral-800">
            {[['/me', 'Me'], ['/clones', 'opersonas'], ['/settings', 'Settings']].map(([href, label]) => (
              <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)}
                className="block rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">{label}</Link>
            ))}
          </nav>
          <div className="mt-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800"><ThemeToggle /></div>
          <button
            type="button"
            role="menuitem"
            className="mt-2 block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={async () => { await signOut(); router.push('/sign-in'); router.refresh(); }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
