'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

export function UserMenu({ name, email }: { name: string; email: string }) {
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
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {name}
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 z-20 mt-1 w-56 p-2 shadow-lg">
          <div className="px-2 py-1 text-xs">
            <div className="font-medium">{name}</div>
            <div className="muted truncate">{email}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="mt-1 block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={async () => { await signOut(); router.push('/sign-in'); router.refresh(); }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
