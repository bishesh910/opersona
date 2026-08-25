'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { ThemeToggle } from './ThemeToggle';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import type { AvatarRecipe } from '@opersona/shared';

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('') || '?';

export function UserMenu({ name, email, avatarRecipe, dropUp = false }: { name: string; email: string; avatarRecipe?: AvatarRecipe | null; dropUp?: boolean }) {
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
    <div ref={ref} className="relative">
      <button type="button" className="flex items-center gap-2 rounded-lg border border-neutral-200 py-1 pl-1 pr-2.5 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800/60" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <AvatarThumb recipe={avatarRecipe} name={name} scale={1.5} />
        <span className="hidden sm:inline" title={name}>{initials(name)}</span>
      </button>
      {open && (
        <div role="menu" className={"card absolute z-20 w-56 p-2 shadow-lg " + (dropUp ? "bottom-full left-0 mb-1" : "right-0 mt-1")}>
          <div className="px-2 py-1 text-xs">
            <div className="font-medium">{name}</div>
            <div className="muted truncate">{email}</div>
          </div>
          <div className="mt-2 px-2"><ThemeToggle /></div>
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
