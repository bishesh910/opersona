/**
 * One-time stamp for databases that predate the squashed `0000_baseline` migration.
 *
 * History: migrations 0000–0020 were squashed into a single baseline on 2026-08-28
 * (the old files live in ../drizzle-archive). A database built before the squash
 * already HAS the baseline schema, but its `drizzle.__drizzle_migrations` ledger
 * doesn't say so — running `db:migrate` would try to re-create every table.
 *
 * This script records the baseline as applied, exactly the way the drizzle
 * migrator would (hash = sha256 of the SQL file, created_at = the journal `when`),
 * so the migrator's skip rule (`created_at >= when` ⇒ skip) holds from then on.
 * Idempotent; refuses to stamp an empty database (run `db:migrate` there instead).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pool } from './client.js';

const dir = new URL('../drizzle/', import.meta.url);
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', dir), 'utf8')) as {
  entries: { when: number; tag: string }[];
};
const base = journal.entries[0];
if (!base?.tag.endsWith('baseline')) throw new Error('journal entry 0 is not the baseline — nothing to stamp');
const sqlText = readFileSync(new URL(`${base.tag}.sql`, dir), 'utf8');
const hash = createHash('sha256').update(sqlText).digest('hex');

const hasAppTables = (await pool.query(
  `select 1 from information_schema.tables where table_schema='public' and table_name='clones'`,
)).rowCount;
if (!hasAppTables) {
  console.log('empty database — nothing to stamp; run `pnpm db:migrate` to create the schema');
} else {
  await pool.query(`create schema if not exists drizzle`);
  await pool.query(
    `create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
  );
  const stamped = (await pool.query(
    `select 1 from drizzle.__drizzle_migrations where created_at >= $1 limit 1`,
    [base.when],
  )).rowCount;
  if (stamped) {
    console.log('already stamped — nothing to do');
  } else {
    await pool.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [hash, base.when]);
    console.log(`stamped ${base.tag} (when=${base.when})`);
  }
}
await pool.end();
