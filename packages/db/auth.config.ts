// Standalone config for the ONE-OFF `pnpm dlx @better-auth/cli@latest generate`
// (run it when better-auth's own schema changes; the emitted file is committed).
// The CLI is deliberately NOT a dependency: it lags the library by minor
// versions and drags known-vulnerable better-auth builds into the lockfile for
// a command nobody runs in CI or at deploy time.
// Standalone config used ONLY by `@better-auth/cli generate` to emit the Drizzle
// schema for auth tables (user/session/account/verification/organization/member/invitation).
// The runtime auth instance lives in apps/web/src/lib/auth.ts.
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const db = drizzle(new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://clone:CHANGE_ME@localhost:5432/opersona' }));
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
});
