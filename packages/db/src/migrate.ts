import { readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

// Guard: a database built before the 0000_baseline squash (app tables exist, but the
// baseline isn't recorded in drizzle.__drizzle_migrations) must be stamped once with
// `pnpm db:baseline` first — otherwise the migrator would replay the full baseline
// DDL against a populated database and fail on the first CREATE TABLE.
const dir = new URL('../drizzle/', import.meta.url);
const base = (JSON.parse(readFileSync(new URL('meta/_journal.json', dir), 'utf8')) as {
  entries: { when: number; tag: string }[];
}).entries[0]!;
const exists = async (q: string, params?: unknown[]) => ((await pool.query(q, params)).rowCount ?? 0) > 0;
const hasAppTables = await exists(
  `select 1 from information_schema.tables where table_schema='public' and table_name='clones'`,
);
if (hasAppTables) {
  const stamped =
    (await exists(`select 1 from information_schema.tables where table_schema='drizzle' and table_name='__drizzle_migrations'`)) &&
    (await exists(`select 1 from drizzle.__drizzle_migrations where created_at >= $1`, [base.when]));
  if (!stamped) {
    console.error(
      'This database predates the squashed baseline migration.\n' +
        'Run `pnpm db:baseline` once to record the baseline as applied, then re-run `pnpm db:migrate`.',
    );
    await pool.end();
    process.exit(1);
  }
}
await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
await pool.end();
console.log('migrations applied');
