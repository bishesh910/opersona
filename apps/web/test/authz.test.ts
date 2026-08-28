/**
 * Tenant-isolation contract for the engine proxy's authorize().
 *
 * Runs only against a scratch/test database (name ending in `_scratch`/`_test`)
 * or when RUN_DB_TESTS=1 — never silently against a production DATABASE_URL.
 * Seeds its own throwaway rows under random org ids and removes them after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { db, pool, schema } from '@opersona/db';
import { authorize } from '@/lib/engine-authz';
import type { OrgCtx } from '@/lib/org';

const dbName = async () => (await pool.query('select current_database() as d')).rows[0].d as string;

const rand = randomUUID().slice(0, 8);
const ORG_A = `tst_org_a_${rand}`;
const ORG_B = `tst_org_b_${rand}`;
const OWNER_A = `tst_user_a1_${rand}`; // org owner of A, owns CLONE_A1
const MEMBER_A = `tst_user_a2_${rand}`; // plain member of A, owns CLONE_A2
const USER_B = `tst_user_b1_${rand}`;
const CLONE_A1 = randomUUID();
const CLONE_A2 = randomUUID();
const CONV_A = randomUUID();
const APPROVAL_A = randomUUID();

const ctx = (userId: string, orgId: string, role: OrgCtx['role']): OrgCtx => ({
  userId, sessionId: 's', user: { id: userId, name: 't', email: `${userId}@test` },
  activeOrganizationId: orgId, twoFactorEnabled: false, approved: true,
  orgId, orgName: 'test', role,
});

let enabled = false;

beforeAll(async () => {
  const name = await dbName().catch(() => '');
  enabled = process.env.RUN_DB_TESTS === '1' || /_scratch$|_test$/.test(name);
  if (!enabled) return;
  await db.insert(schema.clones).values([
    { id: CLONE_A1, orgId: ORG_A, ownerUserId: OWNER_A, name: `tst A1 ${rand}`, kind: 'member' },
    { id: CLONE_A2, orgId: ORG_A, ownerUserId: MEMBER_A, name: `tst A2 ${rand}`, kind: 'member' },
  ]);
  await db.insert(schema.conversations).values({
    id: CONV_A, orgId: ORG_A, cloneId: CLONE_A1, userId: OWNER_A, slug: `tst${rand}`, title: 'tst', mode: 'clone',
  });
  await db.insert(schema.approvals).values({
    id: APPROVAL_A, orgId: ORG_A, cloneId: CLONE_A1, conversationId: CONV_A, kind: 'tool', tool: 'Bash', status: 'pending',
  });
});

afterAll(async () => {
  if (enabled) {
    await db.delete(schema.approvals).where(inArray(schema.approvals.id, [APPROVAL_A]));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, [CONV_A]));
    await db.delete(schema.clones).where(inArray(schema.clones.id, [CLONE_A1, CLONE_A2]));
  }
  await pool.end();
});

describe('authorize() tenant isolation', () => {
  it('another org cannot see a conversation (404, indistinguishable from absent)', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const v = await authorize(ctx(USER_B, ORG_B, 'owner'), 'POST', ['conversations', CONV_A, 'messages']);
    expect(v).toMatchObject({ status: 404 });
  });

  it('another org cannot resolve an approval', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const v = await authorize(ctx(USER_B, ORG_B, 'owner'), 'POST', ['approvals', APPROVAL_A]);
    expect(v).toMatchObject({ status: 404 });
  });

  it('a plain same-org member gets 404 on a colleague clone (no access at all)', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const v = await authorize(ctx(MEMBER_A, ORG_A, 'member'), 'GET', ['clones', CLONE_A1, 'prompt']);
    expect(v).toMatchObject({ status: 404 });
  });

  it('the ORG owner still cannot read a colleague persona prompt/vault (owner-only)', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const prompt = await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'GET', ['clones', CLONE_A2, 'prompt']);
    expect(prompt).toMatchObject({ status: 403 });
    const vault = await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'GET', ['clones', CLONE_A2, 'export-vault']);
    expect(vault).toMatchObject({ status: 403 });
    const snapshot = await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'POST', ['clones', CLONE_A2, 'snapshot']);
    expect(snapshot).toMatchObject({ status: 403 });
  });

  it('accuracy is readable by anyone with clone access', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const v = await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'GET', ['clones', CLONE_A2, 'accuracy']);
    expect(v).toMatchObject({ ok: true, cloneId: CLONE_A2 });
  });

  it('the persona owner gets their own prompt', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const v = await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'GET', ['clones', CLONE_A1, 'prompt']);
    expect(v).toMatchObject({ ok: true, cloneId: CLONE_A1 });
  });

  it('conversation paths are gone entirely (chat moved to the claude.ai connector)', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    const v = await authorize(ctx(MEMBER_A, ORG_A, 'member'), 'POST', ['conversations', CONV_A, 'messages']);
    expect(v).toMatchObject({ status: 404 });
  });

  it('unknown paths are 404 by default', async () => {
    if (!enabled) return; // not a scratch/test DB — see header
    expect(await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'GET', ['nonsense'])).toMatchObject({ status: 404 });
    expect(await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'DELETE', ['clones', CLONE_A1, 'prompt'])).toMatchObject({ status: 404 });
    expect(await authorize(ctx(OWNER_A, ORG_A, 'owner'), 'GET', ['clones', 'not-a-uuid', 'prompt'])).toMatchObject({ status: 404 });
  });
});
