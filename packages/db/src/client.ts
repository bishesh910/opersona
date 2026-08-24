import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import * as authSchema from './auth-schema.js';

const url = process.env.DATABASE_URL ?? 'postgres://clone:CHANGE_ME@localhost:5432/opersona';
export const pool = new pg.Pool({ connectionString: url, max: 10 });
export const db = drizzle(pool, { schema: { ...schema, ...authSchema } });
export type Db = typeof db;
