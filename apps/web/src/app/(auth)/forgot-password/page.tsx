import { redirect } from 'next/navigation';
import { MAILER_ON } from '@/lib/email';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  if (!MAILER_ON) redirect('/sign-in'); // no mailer, no reset links — the link to here is hidden too
  return <ForgotPasswordForm />;
}
