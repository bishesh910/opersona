import { sql } from 'drizzle-orm';
import type { Db } from '@opersona/db';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Delete every org-scoped row for one workspace — every public table carrying an
 * org_id column (enumerated from information_schema, so new tables are covered
 * automatically) — then the organization row itself.
 *
 * Table names are bound via sql.identifier and the org id is a parameter;
 * nothing is string-built. Used by account rejection today and account/persona
 * deletion later; filesystem state under ENGINE_DATA_DIR is the engine's to purge.
 */
export async function wipeOrg(tx: Tx, orgId: string): Promise<void> {
  const tables = await tx.execute(
    sql`select table_name from information_schema.columns where table_schema='public' and column_name='org_id' and table_name <> 'organization'`,
  );
  for (const row of tables.rows as { table_name: string }[]) {
    await tx.execute(sql`delete from ${sql.identifier(row.table_name)} where org_id = ${orgId}`);
  }
  await tx.execute(sql`delete from organization where id = ${orgId}`);
}
