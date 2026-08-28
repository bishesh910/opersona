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
