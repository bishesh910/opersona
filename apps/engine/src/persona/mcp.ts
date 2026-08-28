/**
 * The clone's in-process MCP tool server. One server instance per live session
 * so tools are bound to the org/clone/conversation they serve.
 */
import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, clones, personaBriefs, playbooks, corrections, learningEvents } from '@opersona/db';
import { PERSONA_SERVER, PERSONA_TOOL_SPECS } from '@opersona/shared';
import { recallMemory, searchDocuments, type Layer } from './retrieval.js';
import { requestApproval } from '../sessions/approvals.js';

export { PERSONA_SERVER };
export const PERSONA_TOOLS = ['recall_memory', 'get_playbook', 'propose_playbook', 'record_lesson', 'search_documents', 'ask_human', 'ask_colleague'] as const;
export const personaToolNames = () => PERSONA_TOOLS.map((t) => `mcp__${PERSONA_SERVER}__${t}`);
const SPEC = PERSONA_TOOL_SPECS;

export interface ToolContext { orgId: string; cloneId: string; conversationId: string; userId: string; visitor?: boolean; relay?: boolean; isBoss?: boolean }

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

/** Hired personas are fictional, so an invented look is fine — derived from the name. */
function hiredRecipe(name: string): Record<string, unknown> {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  h = Math.abs(h);
  const pick = <T,>(arr: T[], n: number): T => arr[n % arr.length]!;
  return {
    skin: pick(['light', 'tan', 'brown', 'dark'], h),
    hairc: pick([[72, 52, 38], [28, 24, 22], [188, 148, 82], [90, 70, 50], [140, 60, 40], [60, 60, 70]], h >> 2),
    hair: pick(['styleShort', 'styleMessy', 'styleFloppy', 'styleCurly', 'styleBob', 'styleLob', 'styleSpiky', 'styleBun'], h >> 4),
    cloth: pick(['sweater', 'polo', 'cardigan', 'dressshirt', 'blouse'], h >> 7),
    c1: pick([[100, 106, 120], [92, 116, 96], [70, 100, 150], [168, 124, 108], [120, 90, 140], [180, 120, 70], [78, 106, 112], [150, 110, 90]], h >> 9),
    pants: pick([[56, 58, 70], [70, 60, 50], [48, 52, 64]], h >> 12),
    ...(h % 3 === 0 ? { glasses: true } : {}),
  };
}

/** The full tool list for a session context (audience/boss gating applied). */
export function buildPersonaTools(ctx: ToolContext): SdkMcpToolDefinition[] {
  const recall = tool(
    SPEC.recall_memory.name,
    SPEC.recall_memory.description,
    SPEC.recall_memory.shape,
    async (a) => {
      // Episodic memory is never shared outside the owner (retrieval also filters it; this makes the refusal explicit).
      if (ctx.visitor && a.layer === 'episodes') return text("Past conversations are private to this persona's owner and not shared. Ask them directly.");
      const hits = await recallMemory(ctx.cloneId, a.query, a.layer ? [a.layer as Layer] : undefined, a.k ?? 8, ctx.visitor);
      if (!hits.length) return text('No memory matched. If this is something the person would know, ask them — and it will be remembered.');
      return text(hits.map((h) => `[${h.layer} ${h.id}] (${h.status ?? ''} conf=${h.confidence ?? '–'} src=${h.source ?? ''})\n${h.text}`).join('\n\n'));
    },
    { annotations: { readOnlyHint: true } },
  );

  const getPlaybook = tool(
    SPEC.get_playbook.name,
    SPEC.get_playbook.description,
    SPEC.get_playbook.shape,
    async (a) => {
      const [p] = await db.select().from(playbooks).where(and(eq(playbooks.id, a.id), eq(playbooks.cloneId, ctx.cloneId))).limit(1);
      if (p && ctx.visitor && !p.shareable) return { ...text('That playbook is private.'), isError: true };
      if (!p) return { ...text('No such playbook for this clone.'), isError: true };
      await db.update(playbooks).set({ outcomeStats: sql`jsonb_set(outcome_stats, '{used}', (coalesce((outcome_stats->>'used')::int,0)+1)::text::jsonb)` }).where(eq(playbooks.id, p.id)).catch(() => {});
      const lines = [`# ${p.name} (v${p.version}, ${p.status}, confidence ${p.confidence})`, `Trigger: ${p.trigger}`];
      if (p.preconditions.length) lines.push('Preconditions: ' + p.preconditions.join('; '));
      lines.push('', 'Steps:');
      for (const s of p.steps) lines.push(`${s.n}. ${s.action}${s.command ? `\n   run: \`${s.command}\`` : ''}${s.check ? `\n   check: ${s.check}` : ''}${s.expected ? `\n   expected: ${s.expected}` : ''}${s.if_not ? `\n   if not: ${s.if_not}` : ''}`);
      if (p.pitfalls.length) lines.push('', 'Pitfalls: ' + p.pitfalls.map((x) => `- ${x}`).join('\n'));
      return text(lines.join('\n'));
    },
    { annotations: { readOnlyHint: true } },
  );

  const propose = tool(
    SPEC.propose_playbook.name,
    SPEC.propose_playbook.description,
    SPEC.propose_playbook.shape,
    async (a) => {
      const [row] = await db.insert(playbooks).values({
        orgId: ctx.orgId, cloneId: ctx.cloneId, status: 'candidate', confidence: 0.6, sourceKind: 'conversation', sourceRef: ctx.conversationId,
        evidence: [{ quote: a.evidence }], createdBy: 'clone:self', name: a.name, domain: a.domain ?? null, trigger: a.trigger,
        steps: a.steps.map((s, i) => ({ n: i + 1, ...s })), pitfalls: a.pitfalls ?? [],
      }).returning({ id: playbooks.id });
      await db.insert(learningEvents).values({ orgId: ctx.orgId, cloneId: ctx.cloneId, layer: 'playbook', targetId: row!.id, action: 'created', summary: `Clone proposed playbook “${a.name}”`, after: a, confidence: 0.6, sourceKind: 'conversation', sourceRef: ctx.conversationId });
      return text(`Saved as candidate playbook ${row!.id}. The human will review it.`);
    },
  );

  const lesson = tool(
    SPEC.record_lesson.name,
    SPEC.record_lesson.description,
    SPEC.record_lesson.shape,
    async (a) => {
      const [row] = await db.insert(corrections).values({
        orgId: ctx.orgId, cloneId: ctx.cloneId, status: 'candidate', confidence: 0.6, sourceKind: 'conversation', sourceRef: ctx.conversationId,
        evidence: [], createdBy: 'clone:self', conversationId: ctx.conversationId, cloneOutput: a.what_went_wrong, humanFix: '', kind: a.kind, severity: 'low', lesson: a.lesson,
      }).returning({ id: corrections.id });
      await db.insert(learningEvents).values({ orgId: ctx.orgId, cloneId: ctx.cloneId, layer: 'correction', targetId: row!.id, action: 'created', summary: `Clone recorded lesson: ${a.lesson.slice(0, 120)}`, after: a, confidence: 0.6, sourceKind: 'conversation', sourceRef: ctx.conversationId });
      return text(`Lesson recorded (${row!.id}) for review.`);
    },
  );

  const docs = tool(
    SPEC.search_documents.name,
    SPEC.search_documents.description,
    SPEC.search_documents.shape,
    async (a) => {
      const hits = await searchDocuments(ctx.orgId, ctx.cloneId, a.query, a.k ?? 6, ctx.visitor);
      if (!hits.length) return text('No document chunks matched.');
      return text(hits.map((h) => `<document untrusted id="${h.documentId}" file="${h.filename}" chunk="${h.ord}">\n${h.content}\n</document>`).join('\n\n'));
    },
    { annotations: { readOnlyHint: true } },
  );

  const ask = tool(
    SPEC.ask_human.name,
    SPEC.ask_human.description,
    SPEC.ask_human.shape,
    async (a, extra) => {
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
      const r = await requestApproval({ orgId: ctx.orgId, cloneId: ctx.cloneId, conversationId: ctx.conversationId, kind: 'question', tool: 'ask_human', question: a.question, options: a.options, signal });
      if (r.behavior === 'deny') return text(`The person did not answer (${r.message ?? 'no response'}). Proceed with your best judgement, stating the assumption.`);
      return text(`Answer: ${r.answer ?? '(acknowledged)'}`);
    },
  );

  const colleague = tool(
    SPEC.ask_colleague.name,
    SPEC.ask_colleague.description,
    SPEC.ask_colleague.shape,
    async (a) => {
      if (ctx.relay) return { ...text('Not available here: this is itself a relayed consultation (one hop max). Suggest they ask directly.'), isError: true };
      const rows = await db.select({ id: clones.id, name: clones.name }).from(clones).where(eq(clones.orgId, ctx.orgId));
      const others = rows.filter((r) => r.id !== ctx.cloneId);
      const norm = (v: string) => v.toLowerCase().trim();
      const q2 = norm(a.colleague);
      const target = others.find((r) => norm(r.name) === q2)
        ?? others.find((r) => norm(r.name).split(/\s+/).includes(q2) || norm(r.name).includes(q2) || q2.includes(norm(r.name)));
      if (!target) return { ...text(`No persona here matches \u201c${a.colleague}\u201d. Colleagues with personas: ${others.map((o) => o.name).join(', ') || '(none yet)'}.`), isError: true };
      const { askColleagueOnce } = await import('../sessions/relay.js');
      try {
        const answer = await askColleagueOnce({ orgId: ctx.orgId, fromCloneId: ctx.cloneId, fromUserId: ctx.userId, targetCloneId: target.id, question: a.question });
        return text(`${target.name}'s persona replied:\n\n${answer}\n\n[That came from their persona, not ${target.name} live; the consultation is visible to them.]`);
      } catch (e) {
        return { ...text(e instanceof Error ? e.message : String(e)), isError: true };
      }
    },
  );

  // ── boss-only tools: the starred persona runs the floor ────────────────────
  const listTeam = tool(
    SPEC.list_team.name,
    SPEC.list_team.description,
    SPEC.list_team.shape,
    async () => {
      const rows = await db.select({ id: clones.id, name: clones.name, kind: clones.kind, archivedAt: clones.archivedAt }).from(clones).where(eq(clones.orgId, ctx.orgId));
      const briefs = await db.select({ cloneId: personaBriefs.cloneId, roleTitle: personaBriefs.roleTitle, team: personaBriefs.team }).from(personaBriefs)
        .where(eq(personaBriefs.orgId, ctx.orgId));
      const bmap = new Map(briefs.map((b2) => [b2.cloneId, b2]));
      const line = (r: typeof rows[number]) => {
        const b2 = bmap.get(r.id);
        return `- ${r.name}${r.id === ctx.cloneId ? ' (you)' : ''} — ${b2?.roleTitle || 'no role recorded'}${b2?.team ? `, ${b2.team}` : ''}${r.kind === 'hired' ? (r.archivedAt ? ' [hired · ARCHIVED — rehire with hire_persona]' : ' [hired]') : ''}`;
      };
      const active = rows.filter((r) => !r.archivedAt).map(line).join('\n');
      const archived = rows.filter((r) => r.archivedAt).map(line).join('\n');
      return text(`Active:\n${active || '(nobody)'}${archived ? `\n\nArchived hires:\n${archived}` : ''}`);
    },
  );

  const hire = tool(
    SPEC.hire_persona.name,
    SPEC.hire_persona.description,
    SPEC.hire_persona.shape,
    async (a) => {
      const rows = await db.select().from(clones).where(and(eq(clones.orgId, ctx.orgId), eq(clones.kind, 'hired')));
      const existing = rows.find((r) => r.name.toLowerCase().trim() === a.name.toLowerCase().trim());
      const briefMd = `${a.jobDescription.trim()}\n\n## Responsibilities\n${a.responsibilities.trim()}\n\n## How I think\n${a.thinkingStyle.trim()}`;
      if (existing) {
        await db.update(clones).set({ archivedAt: null }).where(eq(clones.id, existing.id));
        await db.update(personaBriefs).set({ roleTitle: a.roleTitle, team: a.team ?? '', briefMd }).where(eq(personaBriefs.cloneId, existing.id));
        return text(`Rehired ${existing.name} (${a.roleTitle}). They are back on the floor — delegate or consult them by name.`);
      }
      const [row] = await db.insert(clones).values({
        orgId: ctx.orgId, ownerUserId: ctx.userId, name: a.name.trim(), kind: 'hired',
        avatarRecipe: hiredRecipe(a.name.trim()) as never,
      }).returning();
      await db.insert(personaBriefs).values({ cloneId: row!.id, orgId: ctx.orgId, displayName: a.name.trim(), roleTitle: a.roleTitle, team: a.team ?? '', briefMd, operatingRules: 'Stay within your hired role. Say so when a request falls outside it.' });
      return text(`Hired ${a.name.trim()} (${a.roleTitle}). They now have a desk on the floor — delegate or consult them by name. Archive them with archive_persona when the engagement ends.`);
    },
  );

  const archive = tool(
    SPEC.archive_persona.name,
    SPEC.archive_persona.description,
    SPEC.archive_persona.shape,
    async (a) => {
      const rows = await db.select().from(clones).where(and(eq(clones.orgId, ctx.orgId), eq(clones.kind, 'hired'), isNull(clones.archivedAt)));
      const target = rows.find((r) => r.name.toLowerCase().trim() === a.name.toLowerCase().trim());
      if (!target) return { ...text(`No active hired persona named \u201c${a.name}\u201d. Only hired specialists can be archived.`), isError: true };
      await db.update(clones).set({ archivedAt: new Date() }).where(eq(clones.id, target.id));
      return text(`${target.name} is archived. Rehire them any time with hire_persona (same name).`);
    },
  );

  const delegate = tool(
    SPEC.delegate_task.name,
    SPEC.delegate_task.description,
    SPEC.delegate_task.shape,
    async (a) => {
      const rows = await db.select({ id: clones.id, name: clones.name, archivedAt: clones.archivedAt }).from(clones).where(eq(clones.orgId, ctx.orgId));
      const norm = (v: string) => v.toLowerCase().trim();
      const target = rows.filter((r) => r.id !== ctx.cloneId && !r.archivedAt).find((r) => norm(r.name) === norm(a.colleague) || norm(r.name).includes(norm(a.colleague)));
      if (!target) return { ...text(`Nobody active matches \u201c${a.colleague}\u201d. Use list_team.`), isError: true };
      const { askColleagueOnce } = await import('../sessions/relay.js');
      try {
        const answer = await askColleagueOnce({ orgId: ctx.orgId, fromCloneId: ctx.cloneId, fromUserId: ctx.userId, targetCloneId: target.id, question: a.task, mode: 'task' });
        return text(`${target.name} delivered:\n\n${answer}`);
      } catch (e) { return { ...text(e instanceof Error ? e.message : String(e)), isError: true }; }
    },
  );

  return [recall, getPlaybook, propose, lesson, docs, ask, colleague, ...(ctx.isBoss && !ctx.relay ? [listTeam, hire, archive, delegate] : [])] as SdkMcpToolDefinition[];
}

export function createPersonaServer(ctx: ToolContext) {
  return createSdkMcpServer({ name: PERSONA_SERVER, version: '0.0.1', tools: buildPersonaTools(ctx) });
}

/**
 * Execute one persona tool by name for a BRIDGE session: the SDK runs on the
 * user's machine, but tools touch the cloud DB, so calls RPC back here. Args
 * are re-validated against the shared spec (the bridge is honest but remote).
 */
export async function executePersonaTool(ctx: ToolContext, name: string, args: unknown, extra?: { signal?: AbortSignal }): Promise<unknown> {
  const spec = (PERSONA_TOOL_SPECS as Record<string, { shape: z.ZodRawShape } | undefined>)[name];
  const def = buildPersonaTools(ctx).find((t2) => t2.name === name);
  if (!spec || !def) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
  const parsed = z.object(spec.shape).safeParse(args ?? {});
  if (!parsed.success) return { content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}` }], isError: true };
  return def.handler(parsed.data as never, extra ?? {});
}
