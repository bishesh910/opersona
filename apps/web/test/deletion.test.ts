/**
 * Deletion contract: persona deletion clears every clone_id table; account
 * deletion leaves ZERO rows for the org (proved by an information_schema sweep,
 * so new tables are automatically covered) while a second org stays intact.
 * Runs only against a scratch/test database (name _scratch/_test) or with
 * RUN_DB_TESTS=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool, schema, authSchema } from '@opersona/db';
import { wipeClone, deleteUserAccount } from '@/lib/deletion';

const rand = randomUUID().slice(0, 8);
const ORG_A = `tst_del_a_${rand}`;
const ORG_B = `tst_del_b_${rand}`;
const USER_A = `tst_du_a_${rand}`;
const USER_B = `tst_du_b_${rand}`;
const CLONE_A = randomUUID();
const CLONE_B = randomUUID();

let enabled = false;

async function seedOrg(orgId: string, userId: string, cloneId: string) {
  await db.insert(authSchema.user).values({ id: userId, name: 't', email: `${userId}@test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(authSchema.organization).values({ id: orgId, name: orgId, slug: orgId, createdAt: new Date() });
  await db.insert(authSchema.member).values({ id: `m_${userId}`, organizationId: orgId, userId, role: 'owner', createdAt: new Date() });
  await db.insert(authSchema.session).values({ id: `s_${userId}`, token: `tok_${userId}`, userId, expiresAt: new Date(Date.now() + 86400_000), createdAt: new Date(), updatedAt: new Date() });
  await db.insert(schema.clones).values({ id: cloneId, orgId, ownerUserId: userId, name: `tst ${orgId}`, kind: 'member' });
  await db.insert(schema.traits).values({ orgId, cloneId, sourceKind: 'interview', createdBy: userId, kind: 'value', key: 'k1', label: 'L', statement: 'S long enough here', tier: 'explicit' });
  await db.insert(schema.memories).values({ orgId, cloneId, sourceKind: 'interview', createdBy: userId, summary: 'a thing happened' });
  await db.insert(schema.interviewAnswers).values({ orgId, cloneId, questionId: randomUUID(), category: 'values', questionText: 'Q', text: 'A' });
  await db.insert(schema.predictionScenarios).values({ orgId, cloneId, batchId: randomUUID(), category: 'career', scenario: 'a scenario long enough to matter here', question: 'What do you do?' });
  await db.insert(schema.conversations).values({ orgId, cloneId, userId, slug: `tst${orgId.slice(-10)}`, title: 't', mode: 'clone' });
}

/** Rows remaining for an org across EVERY public table with an org_id column. */
async function orgRowCount(orgId: string): Promise<number> {
  const tables = (await db.execute(
    sql`select table_name from information_schema.columns where table_schema='public' and column_name='org_id'`,
  )).rows as { table_name: string }[];
  let total = 0;
  for (const t of tables) {
    const r = await db.execute(sql`select count(*)::int as n from ${sql.identifier(t.table_name)} where org_id = ${orgId}`);
    total += (r.rows[0] as { n: number }).n;
  }
  const org = await db.execute(sql`select count(*)::int as n from organization where id = ${orgId}`);
  return total + (org.rows[0] as { n: number }).n;
}

async function cloneRowCount(cloneId: string): Promise<number> {
  const tables = (await db.execute(
    sql`select table_name from information_schema.columns where table_schema='public' and column_name='clone_id' and table_name <> 'clones'`,
  )).rows as { table_name: string }[];
  let total = 0;
  for (const t of tables) {
    const r = await db.execute(sql`select count(*)::int as n from ${sql.identifier(t.table_name)} where clone_id = ${cloneId}`);
    total += (r.rows[0] as { n: number }).n;
  }
  return total;
}

beforeAll(async () => {
  const name = (await pool.query('select current_database() as d').catch(() => null))?.rows?.[0]?.d as string | undefined;
  enabled = process.env.RUN_DB_TESTS === '1' || /_scratch$|_test$/.test(name ?? '');
  if (!enabled) return;
  await seedOrg(ORG_A, USER_A, CLONE_A);
  await seedOrg(ORG_B, USER_B, CLONE_B);
});

afterAll(async () => {
  if (enabled) {
    // Org A should be gone already; sweep both to be tidy either way.
    for (const [orgId, userId] of [[ORG_A, USER_A], [ORG_B, USER_B]] as const) {
      const tables = (await db.execute(sql`select table_name from information_schema.columns where table_schema='public' and column_name='org_id'`)).rows as { table_name: string }[];
      for (const t of tables) await db.execute(sql`delete from ${sql.identifier(t.table_name)} where org_id = ${orgId}`);
      await db.execute(sql`delete from organization where id = ${orgId}`);
      await db.execute(sql`delete from member where user_id = ${userId}`);
      await db.execute(sql`delete from session where user_id = ${userId}`);
      await db.execute(sql`delete from "user" where id = ${userId}`);
    }
  }
  await pool.end();
});

describe('deletion propagates completely', () => {
  it('persona deletion clears every clone_id table and the clone row', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    expect(await cloneRowCount(CLONE_A)).toBeGreaterThan(0);
    await db.transaction(async (tx) => { await wipeClone(tx, ORG_A, CLONE_A); });
    expect(await cloneRowCount(CLONE_A)).toBe(0);
    const clone = await db.execute(sql`select count(*)::int as n from clones where id = ${CLONE_A}`);
    expect((clone.rows[0] as { n: number }).n).toBe(0);
    // Org B untouched by A's persona deletion.
    expect(await cloneRowCount(CLONE_B)).toBeGreaterThan(0);
  });

  it('account deletion leaves zero org rows and no auth identity; the other org stays intact', async () => {
    if (!enabled) return;
    expect(await orgRowCount(ORG_A)).toBeGreaterThan(0);
    await deleteUserAccount(USER_A, `${USER_A}@test`);
    expect(await orgRowCount(ORG_A)).toBe(0);
    const user = await db.execute(sql`select count(*)::int as n from "user" where id = ${USER_A}`);
    const sess = await db.execute(sql`select count(*)::int as n from session where user_id = ${USER_A}`);
    expect((user.rows[0] as { n: number }).n).toBe(0);
    expect((sess.rows[0] as { n: number }).n).toBe(0);
    // Org B: still fully there.
    expect(await orgRowCount(ORG_B)).toBeGreaterThan(0);
    const userB = await db.execute(sql`select count(*)::int as n from "user" where id = ${USER_B}`);
    expect((userB.rows[0] as { n: number }).n).toBe(1);
  });
});
