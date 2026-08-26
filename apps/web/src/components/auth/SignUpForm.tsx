'use client';
import { PasswordInput } from './PasswordInput';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp } from '@/lib/auth-client';
import { SocialButtons } from './SocialButtons';
import { NIGHT, ErrorNote } from './auth-styles';
import { usePixieMood } from './AuthPixie';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** Cloudflare Turnstile widget — rendered only when the site key env is set (dark by default). */
function TurnstileBox({ onToken }: { onToken: (t: string) => void }) {
  const ref = { current: null as HTMLDivElement | null };
  useEffect(() => {
    const w = window as unknown as { turnstile?: { render: (el: Element, o: Record<string, unknown>) => void } };
    const render = () => { const el = document.getElementById('cf-turnstile-box'); if (el && w.turnstile && !el.hasChildNodes()) w.turnstile.render(el, { sitekey: TURNSTILE_SITE_KEY, theme: 'dark', callback: onToken }); };
    if (w.turnstile) { render(); return; }
    const sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__cfTsReady';
    (window as unknown as Record<string, unknown>).__cfTsReady = render;
    sc.async = true; document.head.appendChild(sc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div id="cf-turnstile-box" ref={(el) => { ref.current = el; }} className="min-h-[65px]" />;
}

export function SignUpForm({ social = { google: false, apple: false }, next, prefillEmail, lockEmail = false, verifyEmail = false }: { social?: { google: boolean; apple: boolean }; next?: string; prefillEmail?: string; lockEmail?: boolean; verifyEmail?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  const setMood = usePixieMood();
  useEffect(() => { setMood(busy ? 'thinking' : 'idle'); }, [busy, setMood]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    if (password !== confirm) { setError('Passwords do not match'); setBusy(false); return; }
    const inviteId = next?.match(/^\/accept-invite\/([\w-]{1,64})$/)?.[1];
    const headers: Record<string, string> = {};
    if (inviteId) headers['x-invite-id'] = inviteId;
    if (captcha) headers['x-captcha-response'] = captcha;
    const res = await signUp.email({ name, email, password, fetchOptions: Object.keys(headers).length ? { headers } : undefined });
    setBusy(false);
    if (res.error) { setError(res.error.message ?? 'Sign-up failed'); return; }
    if (verifyEmail) { setSentTo(email); return; } // account created; a session starts after the emailed link is clicked
    router.push(next ?? '/onboarding');
    router.refresh();
  }

  if (sentTo) {
    return (
      <div className="animate-[card-in_0.3s_ease-out] space-y-3 motion-reduce:animate-none">
        <h1 className="text-xl font-semibold tracking-tight text-white">Check your inbox</h1>
        <p className="text-sm text-neutral-400">We sent a confirmation link to <span className="text-neutral-200">{sentTo}</span>. Click it to activate your account — then your Pixie is waiting.</p>
        <p className="text-xs text-neutral-500">Nothing arriving? Check spam, or <Link className={NIGHT.LINK} href="/sign-in">sign in</Link> to resend.</p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="animate-[card-in_0.3s_ease-out] space-y-4 motion-reduce:animate-none">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-white">Make yourself at home</h1>
        <p className="mt-1 text-sm text-neutral-400">Your Pixie is waiting to meet you.</p>
      </header>
      <SocialButtons google={social.google} apple={social.apple} label="Sign up" />
      <div>
        <label className={NIGHT.LABEL} htmlFor="name">Name</label>
        <input id="name" className={NIGHT.FIELD} required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className={NIGHT.LABEL} htmlFor="email">Email</label>
        <input id="email" className={NIGHT.FIELD + ' read-only:opacity-70'} type="email" required autoComplete="email" value={email} readOnly={lockEmail} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className={NIGHT.LABEL} htmlFor="password">Password</label>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} inputClassName={NIGHT.FIELD + ' pr-11'} buttonClassName={NIGHT.EYE} />
      </div>
      <div>
        <label className={NIGHT.LABEL} htmlFor="confirm">Confirm password</label>
        <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} inputClassName={NIGHT.FIELD + ' pr-11'} buttonClassName={NIGHT.EYE} />
        {confirm.length > 0 && confirm !== password && <p className="mt-1.5 text-xs text-red-300">Passwords don&apos;t match yet.</p>}
      </div>
      {TURNSTILE_SITE_KEY && <TurnstileBox onToken={setCaptcha} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className={NIGHT.BTN} disabled={busy}>{busy ? 'Setting up your desk…' : 'Create account'}</button>
      <p className="pt-1 text-center text-sm text-neutral-400">
        Already have a Pixie?{' '}
        <Link className={NIGHT.LINK} href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}>Sign in</Link>
      </p>
    </form>
  );
}
