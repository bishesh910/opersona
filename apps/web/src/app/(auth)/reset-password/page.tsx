import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={token ?? ''} invalid={!!error || !token} />;
}
