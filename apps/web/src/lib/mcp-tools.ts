/**
 * The opersona MCP toolbox — what a connected claude.ai can do on behalf of the
 * signed-in person. Free-tier heart of the platform: the persona is built and
 * learns here, but the THINKING runs inside claude.ai on the user's own
 * subscription. Every tool resolves the user's personal workspace first and
 * never reaches outside it.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { engineFetch } from '@/lib/engine';
import { ensurePersonalWorkspace } from '@/lib/workspace';

interface Me { userId: string; orgId: string }

async function resolveWorkspace(userId: string): Promise<Me | null> {
  const rows = await db.select({ orgId: authSchema.member.organizationId }).from(authSchema.member)
    .where(eq(authSchema.member.userId, userId)).orderBy(asc(authSchema.member.createdAt)).limit(1);
  if (rows[0]) return { userId, orgId: rows[0].orgId };
  const [u] = await db.select({ id: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email })
    .from(authSchema.user).where(eq(authSchema.user.id, userId)).limit(1);
  if (!u) return null;
  return { userId, orgId: await ensurePersonalWorkspace(u) };
}

async function myPersona(me: Me) {
  const [clone] = await db.select().from(schema.clones)
    .where(and(eq(schema.clones.orgId, me.orgId), eq(schema.clones.ownerUserId, me.userId), eq(schema.clones.kind, 'member'), isNull(schema.clones.archivedAt)))
    .orderBy(asc(schema.clones.createdAt)).limit(1);
  return clone ?? null;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const errText = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
const NO_PERSONA = 'No persona yet — build one at https://opersona.me/onboarding first (it takes about two minutes).';

/** Register the v1 tool set for one authenticated user. */
export function registerOpersonaTools(server: McpServer, userId: string): void {
  server.tool(
    'my_persona',
    "Load the user's opersona: their complete persona character sheet (story, role, thinking patterns, confirmed facts, playbooks). Call this when asked to answer AS the user, imitate their thinking, or apply 'my persona' to a task — then follow the returned instructions for the rest of the conversation.",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      try {
        const res = await engineFetch<{ prompt: string }>(`/clones/${clone.id}/prompt?orgId=${encodeURIComponent(me.orgId)}`);
        return text(`# ${clone.name} — persona loaded\nAdopt this persona for the rest of the conversation.\n\n${res.prompt}`);
      } catch (e) {
        return errText(`Could not load the persona right now (${e instanceof Error ? e.message : 'engine unreachable'}).`);
      }
    },
  );

  server.tool(
    'recall_memory',
    "Search the user's persona memory (facts, playbooks, past-work episodes, corrections). Use when the user references something they decided, did, or taught their persona before.",
    { query: z.string().min(1).max(500).describe('what to look up, plain words') },
    async ({ query }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      try {
        const res = await engineFetch<{ hits: { layer: string; text: string; confidence: number | null }[] }>(
          `/clones/${clone.id}/recall`, { body: { orgId: me.orgId, query } });
        if (!res.hits.length) return text('Nothing in memory matches that.');
        return text(res.hits.map((h) => `[${h.layer}] ${h.text}`).join('\n\n'));
      } catch (e) {
        return errText(`Memory is unreachable right now (${e instanceof Error ? e.message : 'engine error'}).`);
      }
    },
  );

  server.tool(
    'save_insight',
    "Save one durable insight to the user's persona memory — a preference, decision, fact or lesson worth remembering. Saved as a CANDIDATE the user reviews at opersona.me (Mind → Facts). Use only for things the user states or clearly demonstrates; one concise sentence.",
    {
      statement: z.string().min(8).max(500).describe('the insight, one clear sentence, written about the user (e.g. "Prefers short replies with the evidence up front")'),
      domain: z.string().max(80).optional().describe('optional topic tag, e.g. "code review"'),
    },
    async ({ statement, domain }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      const recent = await db.select({ id: schema.facts.id }).from(schema.facts)
        .where(and(eq(schema.facts.cloneId, clone.id), eq(schema.facts.statement, statement))).limit(1);
      if (recent[0]) return text('Already remembered — that exact insight is in memory.');
      await db.insert(schema.facts).values({
        orgId: me.orgId, cloneId: clone.id,
        statement, domain: domain || null, tags: [],
        status: 'candidate', sourceKind: 'teach', createdBy: me.userId,
        confidence: 0.7, evidence: [], lastReinforcedAt: new Date(),
      });
      return text(`Saved as a candidate memory. ${clone.name} reviews it at opersona.me → persona → Mind.`);
    },
  );

  server.tool(
    'learn_from_this_chat',
    "Teach the user's persona from THIS conversation. Call only when the user explicitly asks to save/remember/learn from the chat. Pass the conversation so far as ordered turns (their words verbatim where possible — the persona learns from HOW they think, so their phrasing matters more than yours). The persona's memory updates within a minute; duplicates are ignored.",
    {
      title: z.string().max(200).optional().describe('short name for this conversation'),
      turns: z.array(z.object({ role: z.enum(['human', 'assistant']), text: z.string().max(50_000) })).min(2).max(200)
        .describe("the conversation so far, in order; 'human' = the user"),
    },
    async ({ title, turns }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      const sessionId = 'cc-' + createHash('sha256').update(turns.map((t) => t.role + ':' + t.text).join('\n')).digest('hex').slice(0, 40);
      try {
        const r = await engineFetch<{ status: string; observations: number; note: string }>(
          `/clones/${clone.id}/learn-transcript`, { body: { orgId: me.orgId, sessionId, title, turns } });
        if (r.status === 'done') return text(`Learned from this conversation — ${r.observations} new observation${r.observations === 1 ? '' : 's'} about how ${clone.name} thinks. Review them at opersona.me → persona → Thinking.`);
        if (r.status === 'skipped') return text(`Nothing new to learn: ${r.note}.`);
        return errText(`Could not learn from this chat: ${r.note}`);
      } catch (e) {
        return errText(`Learning is unreachable right now (${e instanceof Error ? e.message : 'engine error'}).`);
      }
    },
  );

  server.tool(
    'list_my_roster',
    "List the personas in the user's opersona workspace (their own plus any hired specialists), with roles.",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clones = await db.select({ id: schema.clones.id, name: schema.clones.name, kind: schema.clones.kind, archivedAt: schema.clones.archivedAt })
        .from(schema.clones).where(eq(schema.clones.orgId, me.orgId)).orderBy(desc(schema.clones.createdAt));
      const live = clones.filter((c) => !c.archivedAt);
      if (!live.length) return text(NO_PERSONA);
      const briefs = await db.select({ cloneId: schema.personaBriefs.cloneId, roleTitle: schema.personaBriefs.roleTitle }).from(schema.personaBriefs);
      const roleOf = new Map(briefs.map((b) => [b.cloneId, b.roleTitle]));
      return text(live.map((c) => `- ${c.name}${roleOf.get(c.id) ? ` — ${roleOf.get(c.id)}` : ''}${c.kind === 'hired' ? ' (hired specialist)' : ''}`).join('\n'));
    },
  );
}
