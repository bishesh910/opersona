'use server';
import { and, asc, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getAskAccess } from '@/lib/clones';
import { orgHasChatKey, orgSealFp } from '@/lib/keys';
import { engineFetch } from '@/lib/engine';
import { DEFAULT_TITLE_RE } from '@/lib/chat';
import type { FeedbackVerdict, HistoryTurn } from '@/components/chat/ChatView';

export interface OfficeChatPayload {
  conversationId: string;
  slug: string;
  title: string;
  history: HistoryTurn[];
  feedback: Record<string, FeedbackVerdict>;
  isOwner: boolean;
  canResolveApprovals: boolean;
  cloneName: string;
  model: string | null;
  effort: string | null;
  showCost: boolean;
  keyMissing: boolean;
  seal: string | null;
  userFirstName: string;
  live: boolean;
}

/**
 * Open the office side-chat with a persona: resume YOUR latest thread with it,
 * or start one. Same access rules as the ask flow — a member only ever sees
 * conversations they created; the persona's owner talks to their own persona
 * (the test surface). This is the munder-difflin "terminal in the sidebar",
 * opersona edition.
 */
export async function openOfficeChat(cloneId: string): Promise<OfficeChatPayload | { error: string }> {
  const ctx = await requireOrg();
  const ask = await getAskAccess(ctx, cloneId);
  if (!ask) return { error: 'Persona not found' };
  let [conv] = await db.select().from(schema.conversations)
    .where(and(
      eq(schema.conversations.orgId, ctx.orgId),
      eq(schema.conversations.cloneId, ask.clone.id),
      eq(schema.conversations.userId, ctx.userId),
      eq(schema.conversations.mode, 'clone'),
    ))
    .orderBy(desc(schema.conversations.createdAt)).limit(1);
  if (!conv) {
    const first = (ctx.user.name?.trim().split(/\s+/)[0]) || ctx.user.email.split('@')[0] || 'a colleague';
    [conv] = await db.insert(schema.conversations)
      .values({ orgId: ctx.orgId, cloneId: ask.clone.id, userId: ctx.userId, title: ask.isOwner ? 'Office chat' : `Asked by ${first}`, mode: 'clone' })
      .returning();
  }
  const turns = await db.select().from(schema.turns)
    .where(eq(schema.turns.conversationId, conv!.id)).orderBy(asc(schema.turns.createdAt));
  const history: HistoryTurn[] = turns.map((t) => ({ id: t.id, role: t.role, content: t.editedContent ?? t.content, toolUses: t.toolUses, files: t.files ?? undefined }));
  const feedback: Record<string, FeedbackVerdict> = {};
  if (ask.isOwner) {
    const fb = await db.select({ turnId: schema.reasoningFeedback.turnId, verdict: schema.reasoningFeedback.verdict })
      .from(schema.reasoningFeedback).where(eq(schema.reasoningFeedback.conversationId, conv!.id));
    for (const f of fb) feedback[f.turnId] = f.verdict;
  }
  return {
    conversationId: conv!.id,
    slug: conv!.slug,
    title: DEFAULT_TITLE_RE.test(conv!.title) && history.length === 0 ? '' : conv!.title,
    history,
    feedback,
    isOwner: ask.isOwner,
    canResolveApprovals: ask.isOwner || ctx.role === 'owner',
    cloneName: ask.clone.name,
    model: conv!.model ?? null,
    effort: conv!.effort ?? null,
    showCost: true,
    keyMissing: !(await orgHasChatKey(ctx.orgId)),
    seal: await orgSealFp(ctx.orgId),
    userFirstName: (ctx.user.name?.trim().split(/\s+/)[0]) || '',
    live: conv!.status === 'live',
  };
}

/** Star a persona as the office boss (org owner/admin only). Starring the current
 *  boss again removes the star. The boss runs the floor: delegates work and hires
 *  temporary specialist personas. */
export async function setBossAction(cloneId: string | null): Promise<void> {
  const ctx = await requireOrg();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw new Error('Only org admins can choose the boss');
  if (cloneId) {
    const ask = await getAskAccess(ctx, cloneId);
    if (!ask) throw new Error('Persona not found');
  }
  await db.insert(schema.orgSettings).values({ orgId: ctx.orgId, bossCloneId: cloneId })
    .onConflictDoUpdate({ target: schema.orgSettings.orgId, set: { bossCloneId: cloneId } });
  revalidatePath('/office');
}

export interface CommandCenterData {
  team: { cloneId: string; name: string; role: string; kind: 'member' | 'hired'; archived: boolean; boss: boolean }[];
  tasks: { slug: string; cloneId: string; assignee: string; title: string; status: string; hasResult: boolean; at: string }[];
  canManage: boolean;
}

/** The boss panel's floor data: the whole team (hired + archived included) and
 *  YOUR delegated tasks with live status. Team identity is org-visible; tasks
 *  are only ever the caller's own conversations. */
export async function openCommandCenter(): Promise<CommandCenterData> {
  const ctx = await requireOrg();
  const [settings] = await db.select({ bossCloneId: schema.orgSettings.bossCloneId }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  const rows = await db
    .select({ id: schema.clones.id, name: schema.clones.name, kind: schema.clones.kind, archivedAt: schema.clones.archivedAt })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId)).orderBy(desc(schema.clones.createdAt));
  const briefs = rows.length
    ? await db.select({ cloneId: schema.personaBriefs.cloneId, roleTitle: schema.personaBriefs.roleTitle })
        .from(schema.personaBriefs)
    : [];
  const roleOf = new Map(briefs.map((b) => [b.cloneId, b.roleTitle]));
  const convs = await db
    .select({ slug: schema.conversations.slug, cloneId: schema.conversations.cloneId, title: schema.conversations.title, status: schema.conversations.status, createdAt: schema.conversations.createdAt, id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.orgId, ctx.orgId), eq(schema.conversations.userId, ctx.userId), like(schema.conversations.title, 'Task from %')))
    .orderBy(desc(schema.conversations.createdAt)).limit(12);
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  const withResult = new Set<string>();
  for (const cv of convs) {
    const [t] = await db.select({ id: schema.turns.id }).from(schema.turns)
      .where(and(eq(schema.turns.conversationId, cv.id), eq(schema.turns.role, 'assistant'))).limit(1);
    if (t) withResult.add(cv.id);
  }
  return {
    team: rows.map((r) => ({ cloneId: r.id, name: r.name, role: roleOf.get(r.id) ?? '', kind: r.kind, archived: !!r.archivedAt, boss: r.id === settings?.bossCloneId })),
    tasks: convs.map((cv) => ({ slug: cv.slug, cloneId: cv.cloneId, assignee: nameOf.get(cv.cloneId) ?? 'persona', title: cv.title, status: cv.status, hasResult: withResult.has(cv.id), at: cv.createdAt.toISOString() })),
    canManage: ctx.role === 'owner' || ctx.role === 'admin',
  };
}

/** Admin lever mirroring the boss's archive/rehire tools (hired personas only). */
export async function setHiredArchivedAction(cloneId: string, archived: boolean): Promise<void> {
  const ctx = await requireOrg();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw new Error('Only org admins');
  const [row] = await db.select({ kind: schema.clones.kind }).from(schema.clones)
    .where(and(eq(schema.clones.id, cloneId), eq(schema.clones.orgId, ctx.orgId))).limit(1);
  if (!row || row.kind !== 'hired') throw new Error('Only hired personas can be archived');
  await db.update(schema.clones).set({ archivedAt: archived ? new Date() : null }).where(eq(schema.clones.id, cloneId));
  revalidatePath('/office');
}

export interface ActivityEvent { kind: 'hired' | 'archived' | 'boss'; text: string; at: string }

/** Org-visible staffing feed: hires, rehires/archives, and who runs the floor.
 *  Deliberately derived only from org-visible tables (clones + settings) — never
 *  from anyone's conversations. */
export async function openActivity(): Promise<{ events: ActivityEvent[] }> {
  const ctx = await requireOrg();
  const [settings] = await db.select({ bossCloneId: schema.orgSettings.bossCloneId, updatedAt: schema.orgSettings.updatedAt }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  const rows = await db
    .select({ id: schema.clones.id, name: schema.clones.name, kind: schema.clones.kind, createdAt: schema.clones.createdAt, archivedAt: schema.clones.archivedAt })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId));
  const briefs = await db.select({ cloneId: schema.personaBriefs.cloneId, roleTitle: schema.personaBriefs.roleTitle }).from(schema.personaBriefs);
  const roleOf = new Map(briefs.map((b) => [b.cloneId, b.roleTitle]));
  const events: ActivityEvent[] = [];
  for (const r of rows) {
    if (r.kind === 'hired') {
      events.push({ kind: 'hired', text: `${r.name} hired${roleOf.get(r.id) ? ` · ${roleOf.get(r.id)}` : ''}`, at: r.createdAt.toISOString() });
      if (r.archivedAt) events.push({ kind: 'archived', text: `${r.name} archived`, at: r.archivedAt.toISOString() });
    }
  }
  if (settings?.bossCloneId) {
    const boss = rows.find((r) => r.id === settings.bossCloneId);
    if (boss) events.push({ kind: 'boss', text: `★ ${boss.name} runs the floor`, at: (settings.updatedAt ?? new Date()).toISOString() });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  return { events: events.slice(0, 25) };
}

export interface MonitorRow {
  cloneId: string; name: string; kind: 'member' | 'hired';
  costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; sessions: number;
}
export interface MonitorData {
  rows: MonitorRow[];
  chatModel: string; chatEffort: string; monthlyBudgetUsd: number | null;
  scope: 'org' | 'mine';
}

/** Monitor — per-persona usage for the last 30 days. Admins see the whole org
 *  (usage costs are admin-governed metadata per the privacy model); members see
 *  their own persona only. Never any content. */
export async function openMonitor(): Promise<MonitorData> {
  const ctx = await requireOrg();
  const admin = ctx.role === 'owner' || ctx.role === 'admin';
  const clones = await db
    .select({ id: schema.clones.id, name: schema.clones.name, kind: schema.clones.kind, ownerUserId: schema.clones.ownerUserId })
    .from(schema.clones).where(eq(schema.clones.orgId, ctx.orgId));
  const visible = admin ? clones : clones.filter((c) => c.ownerUserId === ctx.userId);
  const ids = visible.map((c) => c.id);
  const since = new Date(Date.now() - 30 * 86400000);
  const agg = ids.length
    ? await db.select({
        cloneId: schema.sessionCosts.cloneId,
        costUsd: sql<number>`coalesce(sum(${schema.sessionCosts.costUsd}), 0)`,
        inputTokens: sql<number>`coalesce(sum(${schema.sessionCosts.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${schema.sessionCosts.outputTokens}), 0)::bigint`,
        cacheReadTokens: sql<number>`coalesce(sum(${schema.sessionCosts.cacheReadInputTokens}), 0)::bigint`,
        sessions: sql<number>`count(*)::int`,
      })
        .from(schema.sessionCosts)
        .where(and(eq(schema.sessionCosts.orgId, ctx.orgId), inArray(schema.sessionCosts.cloneId, ids), gte(schema.sessionCosts.createdAt, since)))
        .groupBy(schema.sessionCosts.cloneId)
    : [];
  const aggOf = new Map(agg.map((a) => [a.cloneId, a]));
  const [settings] = await db.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  const rows: MonitorRow[] = visible.map((c) => {
    const a = aggOf.get(c.id);
    return {
      cloneId: c.id, name: c.name, kind: c.kind,
      costUsd: Number(a?.costUsd ?? 0), inputTokens: Number(a?.inputTokens ?? 0), outputTokens: Number(a?.outputTokens ?? 0),
      cacheReadTokens: Number(a?.cacheReadTokens ?? 0), sessions: Number(a?.sessions ?? 0),
    };
  }).sort((x, y) => y.costUsd - x.costUsd || y.outputTokens - x.outputTokens);
  return {
    rows,
    chatModel: settings?.chatModel ?? 'claude-opus-5',
    chatEffort: settings?.chatEffort ?? 'high',
    monthlyBudgetUsd: settings?.monthlyBudgetUsd ?? null,
    scope: admin ? 'org' : 'mine',
  };
}

export interface AskMeItem {
  id: string; cloneId: string; cloneName: string; conversationId: string | null;
  kind: 'tool' | 'question'; tool: string; input: unknown; question?: string; options?: string[];
  createdAt: string; canResolve: boolean;
}

/** Ask-me — everything personas are waiting on YOU for (same access rules as
 *  /approvals: your own personas; org admins see the whole org). */
export async function openAskMe(): Promise<{ items: AskMeItem[] }> {
  const ctx = await requireOrg();
  const admin = ctx.role === 'owner' || ctx.role === 'admin';
  const cloneRows = await db.select({ id: schema.clones.id, name: schema.clones.name, ownerUserId: schema.clones.ownerUserId })
    .from(schema.clones)
    .where(admin ? eq(schema.clones.orgId, ctx.orgId) : and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.ownerUserId, ctx.userId)));
  const ids = cloneRows.map((c) => c.id);
  const pending = ids.length
    ? await db.select().from(schema.approvals)
        .where(and(eq(schema.approvals.orgId, ctx.orgId), eq(schema.approvals.status, 'pending'), inArray(schema.approvals.cloneId, ids)))
        .orderBy(desc(schema.approvals.createdAt)).limit(50)
    : [];
  const nameOf = new Map(cloneRows.map((c) => [c.id, c]));
  return {
    items: pending.map((a) => {
      const c = nameOf.get(a.cloneId);
      return {
        id: a.id, cloneId: a.cloneId, cloneName: c?.name ?? a.cloneId, conversationId: a.conversationId,
        kind: a.kind, tool: a.tool ?? '', input: a.input, question: a.question ?? undefined, options: a.options ?? undefined,
        createdAt: a.createdAt.toISOString(),
        canResolve: c?.ownerUserId === ctx.userId || ctx.role === 'owner',
      };
    }),
  };
}
