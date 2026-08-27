'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getCloneAccess } from '@/lib/clones';
import { snapshotClone } from '@/lib/engine';
import type { ActionResult } from './brief';
import { PlaybookInput } from '@/lib/schemas';

const uuid = z.string().uuid();

async function writable(cloneId: string) {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) return null;
  return ctx;
}

function fmtErr(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

async function finish(cloneId: string, orgId: string): Promise<ActionResult> {
  const snap = await snapshotClone(cloneId, orgId);
  return { ok: true, savedAt: new Date().toISOString(), warning: snap.ok ? undefined : `Saved, but snapshot failed: ${snap.error}` };
}

// ─── facts ──────────────────────────────────────────────────────────────────
const FactInput = z.object({
  cloneId: uuid,
  id: z.string().uuid().optional().or(z.literal('')),
  statement: z.string().trim().min(1).max(2000),
  domain: z.string().trim().max(80).optional().or(z.literal('')),
  tags: z.string().max(500).optional().or(z.literal('')),
  pinned: z.string().optional(),
  shareable: z.string().optional(),
});

export async function saveFactAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = FactInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: fmtErr(parsed.error) };
  const d = parsed.data;
  const ctx = await writable(d.cloneId);
  if (!ctx) return { ok: false, error: 'Not allowed' };
  const tags = (d.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const values = { statement: d.statement, domain: d.domain || null, tags, pinned: d.pinned === 'on', shareable: d.shareable === 'on' };
  if (d.id) {
    await db.update(schema.facts).set({ ...values, updatedAt: new Date(), lastReinforcedAt: new Date() })
      .where(and(eq(schema.facts.id, d.id), eq(schema.facts.cloneId, d.cloneId), eq(schema.facts.orgId, ctx.orgId)));
  } else {
    await db.insert(schema.facts).values({
      ...values, orgId: ctx.orgId, cloneId: d.cloneId,
      status: 'confirmed', sourceKind: 'teach', createdBy: ctx.userId, confidence: 1,
      evidence: [], lastReinforcedAt: new Date(),
    });
  }
  return finish(d.cloneId, ctx.orgId);
}

export async function deleteFactAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const cloneId = String(form.get('cloneId') ?? '');
  const id = String(form.get('id') ?? '');
  if (!uuid.safeParse(id).success) return { ok: false, error: 'bad id' };
  const ctx = await writable(cloneId);
  if (!ctx) return { ok: false, error: 'Not allowed' };
  await db.delete(schema.facts).where(and(eq(schema.facts.id, id), eq(schema.facts.cloneId, cloneId), eq(schema.facts.orgId, ctx.orgId)));
  return finish(cloneId, ctx.orgId);
}

// ─── playbooks ──────────────────────────────────────────────────────────────


export async function savePlaybookAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = PlaybookInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: fmtErr(parsed.error) };
  const d = parsed.data;
  const ctx = await writable(d.cloneId);
  if (!ctx) return { ok: false, error: 'Not allowed' };
  const steps = d.steps.map((s, i) => {
    const out: schema.PlaybookStep = { n: i + 1, action: s.action };
    if (s.command) out.command = s.command;
    if (s.check) out.check = s.check;
    if (s.expected) out.expected = s.expected;
    if (s.if_not) out.if_not = s.if_not;
    return out;
  });
  const values = { name: d.name, domain: d.domain || null, trigger: d.trigger, preconditions: d.preconditions, steps, pitfalls: d.pitfalls, shareable: d.shareable ?? true };
  let id = d.id;
  if (id) {
    const [existing] = await db.select().from(schema.playbooks)
      .where(and(eq(schema.playbooks.id, id), eq(schema.playbooks.cloneId, d.cloneId), eq(schema.playbooks.orgId, ctx.orgId))).limit(1);
    if (!existing) return { ok: false, error: 'Playbook not found' };
    await db.transaction(async (tx) => {
      await tx.insert(schema.playbookRevisions).values({ playbookId: existing.id, version: existing.version, snapshot: existing, reason: 'edited in UI', createdBy: ctx.userId });
      await tx.update(schema.playbooks).set({ ...values, version: sql`${schema.playbooks.version} + 1`, updatedAt: new Date(), lastReinforcedAt: new Date() })
        .where(eq(schema.playbooks.id, existing.id));
    });
  } else {
    const [row] = await db.insert(schema.playbooks).values({
      ...values, orgId: ctx.orgId, cloneId: d.cloneId,
      status: 'confirmed', sourceKind: 'teach', createdBy: ctx.userId, confidence: 1, evidence: [], lastReinforcedAt: new Date(),
    }).returning({ id: schema.playbooks.id });
    id = row!.id;
  }
  return { ...(await finish(d.cloneId, ctx.orgId)), id };
}

export async function deletePlaybookAction(cloneId: string, id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'bad id' };
  const ctx = await writable(cloneId);
  if (!ctx) return { ok: false, error: 'Not allowed' };
  await db.transaction(async (tx) => {
    await tx.delete(schema.playbookRevisions).where(eq(schema.playbookRevisions.playbookId, id));
    await tx.delete(schema.playbooks).where(and(eq(schema.playbooks.id, id), eq(schema.playbooks.cloneId, cloneId), eq(schema.playbooks.orgId, ctx.orgId)));
  });
  return finish(cloneId, ctx.orgId);
}

/** Forget one episode (owner of the persona only). */
export async function deleteEpisodeAction(cloneId: string, episodeId: string): Promise<{ ok: boolean }> {
  const ctx = await requireOrg();
  const access = await getCloneAccess(ctx, cloneId);
  if (!access?.canWrite) return { ok: false };
  await db.delete(schema.episodes).where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.cloneId, access.clone.id)));
  revalidatePath(`/opersonas/${access.clone.id}/memory`); revalidatePath('/me/memory');
  return { ok: true };
}
