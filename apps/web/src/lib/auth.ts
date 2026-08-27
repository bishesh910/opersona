import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { captcha, jwt, organization, twoFactor } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { nextCookies } from 'better-auth/next-js';
import { and, eq, gt } from 'drizzle-orm';
import { db, authSchema } from '@opersona/db';
import { accountLocked } from './auth-abuse';
import { MAILER_ON, sendEmail } from './email';

/** ALLOW_SIGNUP=true opens sign-up to anyone (how opersona.me runs). Default:
 *  INVITE-ONLY — an account can be created solely for an email holding a pending
 *  invitation (the safe default for fresh self-hosts). */
export const SIGNUP_OPEN = process.env.ALLOW_SIGNUP === 'true';

/** REQUIRE_2FA=true makes two-factor mandatory (pre-pivot behaviour, for locked-down
 *  self-hosts). Default: optional + nudged from Settings. */
export const REQUIRE_2FA = process.env.REQUIRE_2FA === 'true';

/** Throwaway-email domains rejected at open signup — a speed bump, not a wall. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la',
  '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'temp-mail.io', 'tempmail.com',
  'tempmail.dev', 'tempmailo.com', 'throwawaymail.com', 'trashmail.com', 'trashmail.de',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'getnada.com', 'nada.email',
  'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com',
  'spamgourmet.com', 'mytemp.email', 'burnermail.io', 'mail-temp.com', 'moakt.com',
  'tmpmail.org', 'tmpmail.net', 'tmails.net', 'fakermail.com', 'inboxkitten.com',
  'mail7.io', 'emailondeck.com', 'mailsac.com', 'mailcatch.com', 'spambog.com',
  'mailexpire.com', 'incognitomail.org', 'anonbox.net', 'crazymailing.com',
  'tempinbox.com', 'fakeinbox.com', 'onetimemail.org', 'discard.email', 'discardmail.com',
  'spam4.me', 'tempr.email', 'luxusmail.org', 'cock.li', 'har-vard.edu',
]);
export const isDisposableEmail = (email: string): boolean => DISPOSABLE_DOMAINS.has(email.split('@')[1]?.toLowerCase() ?? '');

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
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // Verification/reset light up only when a mailer is configured; without one the
    // app stays fully usable (no dead ends on self-hosts).
    requireEmailVerification: MAILER_ON && SIGNUP_OPEN,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({ to: user.email, subject: 'Reset your opersona password', text: `Someone (hopefully you) asked to reset the password for ${user.email}.\n\nReset it here: ${url}\n\nIf this wasn't you, ignore this email — nothing changes.` });
    },
  },
  emailVerification: {
    sendOnSignUp: MAILER_ON,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, subject: 'Verify your opersona email', text: `Welcome to opersona!\n\nConfirm this address to activate your account: ${url}` });
    },
  },
  // Backstop for EVERY account-creation path (email, social, future providers): when
  // sign-ups are closed, an account may only be created for an email that holds a live
  // pending invitation. The route hook above additionally requires possession of the
  // invite LINK on the email path; this database hook is what stops a social login
  // from self-provisioning around the invite gate.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (SIGNUP_OPEN) {
            const email = String(user.email ?? '').trim().toLowerCase();
            if (isDisposableEmail(email)) throw new APIError('BAD_REQUEST', { message: 'Disposable email addresses cannot be used — sign up with a real inbox.' });
            return;
          }
          const email = String(user.email ?? '').trim().toLowerCase();
          const rows = email
            ? await db.select({ id: authSchema.invitation.id }).from(authSchema.invitation)
                .where(and(eq(authSchema.invitation.email, email), eq(authSchema.invitation.status, 'pending'), gt(authSchema.invitation.expiresAt, new Date()))).limit(1)
            : [];
          if (!rows.length) throw new APIError('FORBIDDEN', { message: 'Sign-ups are invite-only. Ask your organization for an invitation.' });
        },
        // Every account gets a personal workspace (org-of-one) the moment it exists —
        // covers email signup AND social providers. Never fails the signup: getOrgCtx()
        // self-heals any account this hook missed.
        after: async (user) => {
          try {
            const { ensurePersonalWorkspace } = await import('./workspace');
            await ensurePersonalWorkspace(user);
          } catch (e) {
            console.error('[auth] personal workspace creation failed (self-heals on first request)', e);
          }
        },
      },
    },
  },
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
  // 60-day sliding window: any request more than a day after the last refresh
  // re-stamps the session for another 60 days, so active users stay signed in
  // indefinitely. The matching safety valve is Settings -> Account -> Devices
  // (review active sessions, sign out any of them).
  session: { expiresIn: 60 * 60 * 24 * 60, updateAge: 60 * 60 * 24 },
  advanced: {
    useSecureCookies: (process.env.BETTER_AUTH_URL ?? '').startsWith('https://'),
    // Caddy terminates TLS in front of us: without this, rate limiting cannot see
    // client IPs and every visitor shares ONE bucket (5 signups/hour for the whole
    // internet — discovered the hard way on launch day).
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },
  socialProviders: {
    ...(SOCIAL.google ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } } : {}),
    ...(SOCIAL.apple ? { apple: { clientId: process.env.APPLE_CLIENT_ID!, clientSecret: process.env.APPLE_CLIENT_SECRET!, appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER } } : {}),
  },
  plugins: [
    organization({ allowUserToCreateOrganization: (user) => isPlatformAdmin(user.email) }),
    twoFactor({ issuer: 'opersona' }),
    // ── claude.ai connector: opersona as an OAuth 2.1 authorization server ──
    // jwt() supplies /jwks + token signing; mcp() is the oauth-provider tuned for
    // MCP (RFC 9728 protected-resource metadata, resource-bound tokens, DCR so
    // claude.ai can self-register). Tools live in /mcp (route handler).
    jwt(),
    mcp({
      loginPage: '/sign-in',
      consentPage: '/oauth/consent',
      resource: `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/mcp`,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationRequirePKCE: true,
    }),
    // Bot wall, dark until the env is set (flip = add the two Turnstile envs + restart).
    ...(process.env.TURNSTILE_SECRET_KEY
      ? [captcha({ provider: 'cloudflare-turnstile', secretKey: process.env.TURNSTILE_SECRET_KEY, endpoints: ['/sign-up/email', '/forget-password'] })]
      : []),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
