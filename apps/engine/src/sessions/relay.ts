/**
 * Persona-to-persona consultation ("the hive wire") — one persona puts a
 * question to a colleague's persona and gets its reply.
 *
 * Shape: a ONE-SHOT non-interactive session against the target persona,
 * persisted as a REAL conversation owned by the human whose chat triggered
 * the consult. That keeps every privacy rule intact for free:
 *  - the target answers with its VISITOR prompt (shareable-only) unless the
 *    asking human owns it;
 *  - the conversation is visible to the target's owner exactly like any
 *    visitor conversation (the disclosed rule on /privacy);
 *  - one hop max: a relayed session cannot itself consult anyone (no
 *    ping-pong livelock — the munder-difflin hop-cap lesson);
 *  - no ask_human, no shell, no approvals in the relay: it must finish on
 *    its own or time out.
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { and, eq } from 'drizzle-orm';
import { db, clones, conversations, turns, sessionCosts, authSchema } from '@opersona/db';
import { redactSecrets } from '@opersona/shared';
import { orgModelConfig } from '../keys.js';
import { ensureWorkspace, conversationWorkdir } from '../isolation/workspace.js';
import { activePrompt } from '../persona/assemble.js';
import { createPersonaServer, PERSONA_SERVER } from '../persona/mcp.js';
import { sessionEnv } from './manager.js';

const RELAY_TIMEOUT_MS = 150_000;
const RELAY_MAX_TURNS = 8;

export async function askColleagueOnce(args: {
  orgId: string;
  fromCloneId: string;
  fromUserId: string;
  targetCloneId: string;
  question: string;
}): Promise<string> {
  if (args.targetCloneId === args.fromCloneId) throw new Error('cannot consult yourself');
  const [target] = await db.select().from(clones)
    .where(and(eq(clones.id, args.targetCloneId), eq(clones.orgId, args.orgId))).limit(1);
  if (!target) throw new Error('colleague persona not found');
  const [asker] = await db.select({ name: clones.name }).from(clones).where(eq(clones.id, args.fromCloneId)).limit(1);
  const [user] = await db.select({ name: authSchema.user.name }).from(authSchema.user).where(eq(authSchema.user.id, args.fromUserId)).limit(1);
  const first = (user?.name?.trim().split(/\s+/)[0]) || 'a colleague';
  const viaName = asker?.name ?? 'a persona';
  const visitor = args.fromUserId !== target.ownerUserId;

  // A real conversation row — the target's owner sees this consult like any
  // visitor conversation. New row per consult keeps each exchange legible.
  const [conv] = await db.insert(conversations).values({
    orgId: args.orgId, cloneId: target.id, userId: args.fromUserId, mode: 'clone',
    title: `Asked by ${first} (via ${viaName}’s persona)`,
  }).returning();
  const question = redactSecrets(args.question).slice(0, 20_000);
  await db.insert(turns).values({
    conversationId: conv!.id, orgId: args.orgId, role: 'user',
    content: `[relayed by ${viaName}’s persona on behalf of ${first}]\n\n${question}`,
  });

  const cfg = await orgModelConfig(args.orgId);
  const ws = ensureWorkspace(args.orgId, target.id);
  const workdir = conversationWorkdir(args.orgId, target.id, conv!.id);
  const { prompt, promptHash } = await activePrompt(args.orgId, target.id, visitor ? 'visitor' : 'owner');
  const server = createPersonaServer({
    orgId: args.orgId, cloneId: target.id, conversationId: conv!.id,
    userId: args.fromUserId, visitor, relay: true,
  });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RELAY_TIMEOUT_MS);
  const options: Options = {
    model: cfg.chatModel,
    effort: cfg.chatEffort as Options['effort'],
    systemPrompt: prompt,
    cwd: workdir,
    env: sessionEnv(ws, cfg.apiKey),
    settingSources: [],
    tools: [], // persona MCP only — a consult reasons and recalls, it does not run code
    disallowedTools: [`mcp__${PERSONA_SERVER}__ask_human`, `mcp__${PERSONA_SERVER}__ask_colleague`],
    mcpServers: { [PERSONA_SERVER]: server },
    canUseTool: async (toolName, toolInput) =>
      toolName.startsWith(`mcp__${PERSONA_SERVER}__`)
        ? { behavior: 'allow', updatedInput: toolInput }
        : { behavior: 'deny', message: 'not available in a relayed consultation' },
    permissionMode: 'default',
    maxTurns: RELAY_MAX_TURNS,
    abortController: abort,
    persistSession: false,
  };

  const preface = `[This question is relayed by ${viaName}’s persona on behalf of ${first}. Answer it directly and completely — the reply is returned verbatim to them. You cannot ask follow-up questions here.]\n\n`;
  let text = '';
  const toolUses: { id: string; name: string; input: unknown; ok?: boolean }[] = [];
  try {
    for await (const m of query({ prompt: preface + question, options }) as AsyncIterable<SDKMessage>) {
      if (m.type === 'assistant') {
        for (const block of m.message.content) {
          if (block.type === 'text') text += block.text;
          else if (block.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && !text.trim()) text = m.result;
        const u = m.usage;
        await db.insert(sessionCosts).values({
          orgId: args.orgId, cloneId: target.id, conversationId: conv!.id, kind: 'chat', model: cfg.chatModel, promptHash,
          inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
          cacheReadInputTokens: u.cache_read_input_tokens ?? 0, cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
          costUsd: m.total_cost_usd ?? null,
        }).catch((e) => console.error('[relay cost]', e));
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const answer = text.trim();
  await db.insert(turns).values({
    conversationId: conv!.id, orgId: args.orgId, role: 'assistant',
    content: redactSecrets(answer || '[the persona did not produce an answer in time]'),
    ...(toolUses.length ? { toolUses } : {}),
  }).catch((e) => console.error('[relay turn]', e));
  await db.update(conversations).set({ status: 'idle', lastActivityAt: new Date() }).where(eq(conversations.id, conv!.id)).catch(() => {});
  if (!answer) throw new Error(`${target.name}’s persona did not answer in time — try again or ask them directly`);
  return answer;
}
