import { sql } from 'drizzle-orm';
import { db, type Db } from '@opersona/db';
import { engineFetch } from '@/lib/engine';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Delete every org-scoped row for one workspace — every public table carrying an
 * org_id column (enumerated from information_schema, so new tables are covered
 * automatically) — then the organization row itself.
 *
 * Table names are bound via sql.identifier and the org id is a parameter;
 * nothing is string-built. Filesystem state under ENGINE_DATA_DIR is purged
 * separately via the engine (purgeOrgFiles).
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

/**
 * Delete every row belonging to one persona — every public table carrying a
 * clone_id column, scoped by org — then the clone row itself. Covers interview
 * answers, knowledge (memories/traits/rules), scenarios, simulations,
 * conversations, patterns, snapshots, published listings… automatically as the
 * schema grows. The caller purges engine files afterwards.
 */
export async function wipeClone(tx: Tx, orgId: string, cloneId: string): Promise<void> {
  const tables = await tx.execute(
    sql`select c1.table_name from information_schema.columns c1
        join information_schema.columns c2 on c2.table_name = c1.table_name and c2.table_schema = 'public' and c2.column_name = 'org_id'
        where c1.table_schema='public' and c1.column_name='clone_id' and c1.table_name <> 'clones'`,
  );
  for (const row of tables.rows as { table_name: string }[]) {
    await tx.execute(sql`delete from ${sql.identifier(row.table_name)} where clone_id = ${cloneId} and org_id = ${orgId}`);
  }
  // clone_id tables without org_id (defensive: none today, keep covered)
  const noOrg = await tx.execute(
    sql`select table_name from information_schema.columns c1
        where c1.table_schema='public' and c1.column_name='clone_id' and c1.table_name <> 'clones'
        and not exists (select 1 from information_schema.columns c2 where c2.table_schema='public' and c2.table_name=c1.table_name and c2.column_name='org_id')`,
  );
  for (const row of noOrg.rows as { table_name: string }[]) {
    await tx.execute(sql`delete from ${sql.identifier(row.table_name)} where clone_id = ${cloneId}`);
  }
  await tx.execute(sql`update org_settings set boss_clone_id = null where org_id = ${orgId} and boss_clone_id = ${cloneId}`);
  await tx.execute(sql`delete from clones where id = ${cloneId} and org_id = ${orgId}`);
}

/** Best-effort engine file purge (uploads, clone workspaces). DB truth never depends on it. */
export async function purgeOrgFiles(orgId: string): Promise<void> {
  await engineFetch(`/orgs/purge-files`, { body: { orgId } }).catch((e) => console.error('[deletion] org file purge failed', orgId, e));
}
export async function purgeCloneFiles(orgId: string, cloneId: string, documentIds: string[] = []): Promise<void> {
  await engineFetch(`/clones/${cloneId}/purge-files`, { body: { orgId, documentIds } }).catch((e) => console.error('[deletion] clone file purge failed', cloneId, e));
}

/**
 * Delete a user account outright: every solely-owned workspace is wiped (DB +
 * engine files), shared workspaces just lose the membership, then the auth rows
 * (sessions, accounts, verifications, user) go. Used by admin rejection and by
 * self-serve account deletion.
 */
export async function deleteUserAccount(userId: string, email: string): Promise<{ wipedOrgs: string[] }> {
  const memberships = (await db.execute(sql`select organization_id as org_id from member where user_id = ${userId}`)).rows as { org_id: string }[];
  const wipedOrgs: string[] = [];
  await db.transaction(async (tx) => {
    for (const m of memberships) {
      const others = (await tx.execute(sql`select count(*)::int as n from member where organization_id = ${m.org_id} and user_id <> ${userId}`)).rows[0] as { n: number };
      if ((others?.n ?? 0) > 0) continue; // shared org: leave it, just drop the membership below
      await wipeOrg(tx, m.org_id);
      wipedOrgs.push(m.org_id);
    }
    await tx.execute(sql`delete from member where user_id = ${userId}`);
    await tx.execute(sql`delete from session where user_id = ${userId}`);
    await tx.execute(sql`delete from account where user_id = ${userId}`);
    await tx.execute(sql`delete from verification where identifier = ${email}`);
    await tx.execute(sql`delete from "user" where id = ${userId}`);
  });
  for (const orgId of wipedOrgs) await purgeOrgFiles(orgId);
  return { wipedOrgs };
}
