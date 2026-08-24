'use server';
import { z } from 'zod';
import { db, schema, authSchema } from '@opersona/db';
import { eq } from 'drizzle-orm';
import { requireOrg, isOrgAdmin } from '@/lib/session';
import type { ActionResult } from './brief';

const Input = z.object({
  chatModel: z.string().trim().min(1).max(100),
  extractModel: z.string().trim().min(1).max(100),
  condenseModel: z.string().trim().min(1).max(100),
  chatEffort: z.enum(['low', 'medium', 'high', 'max']),
  timezone: z.string().trim().min(1).max(64),
  monthlyBudgetUsd: z.string().optional().or(z.literal('')),
});

export async function saveSettingsAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!isOrgAdmin(ctx)) return { ok: false, error: 'Org owner/admin only' };
  const parsed = Input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const d = parsed.data;
  try { Intl.DateTimeFormat(undefined, { timeZone: d.timezone }); } catch { return { ok: false, error: 'Unknown timezone' }; }
  const budget = d.monthlyBudgetUsd ? Number(d.monthlyBudgetUsd) : null;
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return { ok: false, error: 'Budget must be a positive number' };
  const values = { chatModel: d.chatModel, extractModel: d.extractModel, condenseModel: d.condenseModel, chatEffort: d.chatEffort, timezone: d.timezone, monthlyBudgetUsd: budget };
  await db.insert(schema.orgSettings).values({ orgId: ctx.orgId, ...values })
    .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { ...values, updatedAt: new Date() } });
  return { ok: true, savedAt: new Date().toISOString() };
}

const NameInput = z.object({ name: z.string().trim().min(1).max(80) });

/** Rename the organization (owner/admin only). */
export async function renameOrgAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!isOrgAdmin(ctx)) return { ok: false, error: 'Org owner/admin only' };
  const parsed = NameInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'Name must be 1–80 characters' };
  await db.update(authSchema.organization).set({ name: parsed.data.name }).where(eq(authSchema.organization.id, ctx.orgId));
  return { ok: true, savedAt: new Date().toISOString() };
}

/** Rename your own account (the name shown in the header and roster). */
export async function renameSelfAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await requireOrg();
  const parsed = NameInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'Name must be 1–80 characters' };
  await db.update(authSchema.user).set({ name: parsed.data.name }).where(eq(authSchema.user.id, ctx.userId));
  return { ok: true, savedAt: new Date().toISOString() };
}
