'use client';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button type="button" className="btn-secondary btn-sm"
      onClick={async () => { await signOut(); router.push('/sign-in'); router.refresh(); }}>
      Sign out
    </button>
  );
}
