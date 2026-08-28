import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import * as authSchema from './auth-schema.js';

const url = process.env.DATABASE_URL;
// In production a missing DATABASE_URL must fail loudly, never fall through to a
// guessable default. The dev fallback carries no real credential (auth always fails
// unless you created that user yourself).
if (!url && process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
export const databaseUrl = url ?? 'postgres://clone:CHANGE_ME@localhost:5432/opersona';
export const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
export const db = drizzle(pool, { schema: { ...schema, ...authSchema } });
export type Db = typeof db;
