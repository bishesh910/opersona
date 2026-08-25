import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { and, eq, gt } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { accountLocked } from './auth-abuse';

/** ALLOW_SIGNUP=true opens sign-up to anyone (dev only). Default: INVITE-ONLY —
 *  an account can be created solely for an email holding a pending invitation. */
export const SIGNUP_OPEN = process.env.ALLOW_SIGNUP === 'true';

/** Platform admins: the only accounts allowed to create organizations. */
export const PLATFORM_ADMINS = (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isPlatformAdmin = (email?: string | null) => !!email && PLATFORM_ADMINS.includes(email.toLowerCase());

async function pendingInvitationMatches(inviteId: string, email: string): Promise<boolean> {
  if (!/^[\w-]{1,64}$/.test(inviteId)) return false;
  const rows = await db.select({ email: authSchema.invitation.email }).from(authSchema.invitation)
    .where(and(eq(authSchema.invitation.id, inviteId), eq(authSchema.invitation.status, 'pending'), gt(authSchema.invitation.expiresAt, new Date()))).limit(1);
  return rows.length > 0 && rows[0]!.email.toLowerCase() === email.toLowerCase();
}

const trusted = (process.env.TRUSTED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((s) => s.trim()).filter(Boolean);
if (process.env.BETTER_AUTH_URL && !trusted.includes(process.env.BETTER_AUTH_URL)) trusted.push(process.env.BETTER_AUTH_URL);

/** Social sign-in lights up per provider when its env vars are set (requires a real domain — see deploy/README.md). */
export const SOCIAL = {
  google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  apple: !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
};

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  trustedOrigins: trusted,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
  // Invite-only gate: sign-up succeeds ONLY for an email with a live pending invitation
  // (or when ALLOW_SIGNUP=true). Enforced here, in the auth layer — not in the UI.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/email') {
        const email = String((ctx.body as { email?: string } | undefined)?.email ?? '').trim().toLowerCase();
        if (email && (await accountLocked(email))) {
          throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many failed attempts for this account. Try again in 15 minutes.' });
        }
      }
      if (ctx.path === '/sign-up/email' && !SIGNUP_OPEN) {
        // Possession of the invite LINK is required (x-invite-id), and the invitation must
        // be live and match the signup email — knowing an invited email is not enough.
        const email = String((ctx.body as { email?: string } | undefined)?.email ?? '').trim();
        const inviteId = ctx.headers?.get('x-invite-id') ?? '';
        if (!email || !inviteId || !(await pendingInvitationMatches(inviteId, email))) {
          throw new APIError('FORBIDDEN', { message: 'Sign-ups are invite-only. Open your invitation link to create your account.' });
        }
      }
    }),
  },
  // Brute-force protection: 10 auth requests per minute per IP, stricter on sign-in.
  rateLimit: { enabled: true, storage: 'database', window: 60, max: 20, customRules: { '/sign-in/email': { window: 300, max: 8 }, '/sign-up/email': { window: 3600, max: 5 }, '/forget-password': { window: 3600, max: 5 } } },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  advanced: { useSecureCookies: (process.env.BETTER_AUTH_URL ?? '').startsWith('https://') },
  socialProviders: {
    ...(SOCIAL.google ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } } : {}),
    ...(SOCIAL.apple ? { apple: { clientId: process.env.APPLE_CLIENT_ID!, clientSecret: process.env.APPLE_CLIENT_SECRET!, appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER } } : {}),
  },
  plugins: [
    organization({ allowUserToCreateOrganization: (user) => isPlatformAdmin(user.email) }),
    twoFactor({ issuer: 'opersona' }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
