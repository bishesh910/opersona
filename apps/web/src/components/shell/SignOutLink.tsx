'use client';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
export function SignOutLink({ className = 'underline' }: { className?: string }) {
  const router = useRouter();
  return <button type="button" className={className} onClick={async () => { await signOut(); router.push('/sign-in'); router.refresh(); }}>Sign out</button>;
}
