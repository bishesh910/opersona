import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { recordSignInResult } from '@/lib/auth-abuse';

const handler = toNextJsHandler(auth);

/** Wrap the POST so we can see the ACTUAL response status of a sign-in and drive
 *  per-account lockout — better-auth's after-hooks don't fire on a failed (thrown) login. */
export const GET = handler.GET;
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const isSignIn = url.pathname.endsWith('/sign-in/email');
  let email = '';
  if (isSignIn) {
    try { const body = await req.clone().json(); email = String(body?.email ?? '').trim().toLowerCase(); } catch { /* ignore */ }
  }
  const res = await handler.POST(req);
  if (isSignIn && email) await recordSignInResult(email, res.status).catch(() => {});
  return res;
}
