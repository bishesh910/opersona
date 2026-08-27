/**
 * opersona bridge wire protocol — one outbound WebSocket from the user's
 * machine to the engine. The bridge runs Claude Agent SDK sessions under the
 * user's own local Claude Code login; the engine ships session requests down
 * and consumes the same SDKMessage stream it would get from a local subprocess.
 *
 * Trust model: the bridge authenticates with an opersona bridge token (obr_…);
 * nothing Anthropic-related ever crosses this socket. The engine never sends
 * shell commands — only typed session requests; tool/approval frames let the
 * cloud execute persona tools (DB) and route human approvals exactly as for
 * local sessions.
 */
import { z } from 'zod';

export const BRIDGE_PROTOCOL_VERSION = 1;

// ── engine → bridge ─────────────────────────────────────────────────────────
export interface BridgeStart {
  t: 'start';
  sid: string;                       // engine-chosen session id (conversation-scoped)
  conversationId: string;
  systemPrompt: string;
  model: string;
  effort?: string;
  resume?: string;                   // sdk session id to resume
  tools: string[];                   // persona tool names to expose (already audience/boss-filtered)
  builtinTools: string[];            // SDK built-ins the bridge may offer (read-only set in v1)
  maxTurns: number;
}
export interface BridgeUserMsg { t: 'msg'; sid: string; message: unknown }   // SDKUserMessage passthrough
export interface BridgeCancel { t: 'cancel'; sid: string }
export interface BridgeToolResult { t: 'toolResult'; id: string; result?: unknown; error?: string }
export interface BridgeApprovalResult { t: 'approvalResult'; id: string; behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown }
export interface BridgePing { t: 'ping' }
/** One-shot inference job (learning/titling/condense) run on the user's subscription. */
export interface BridgeJob {
  t: 'job';
  id: string;
  kind: 'structured' | 'text';
  model: string;
  effort?: string;
  system: string;
  user: string;
  /** JSON Schema (draft 2020-12, no $schema tag) for kind='structured'. */
  schema?: Record<string, unknown>;
  /** Optional image for vision jobs (selfie → pixie). */
  image?: { base64: string; mime: string };
  /** Sealed-content substitution: `user` may contain <<SEALED:i>> markers; the
   *  bridge decrypts sealed[i] with its local key and substitutes before the
   *  model ever sees the prompt. The server only ever holds the ciphertext. */
  sealed?: string[];
}
export interface BridgeIngestResult { t: 'ingestResult'; id: string; status: string; observations?: number; note?: string }
export type EngineToBridge = BridgeStart | BridgeUserMsg | BridgeCancel | BridgeToolResult | BridgeApprovalResult | BridgePing | BridgeJob | BridgeIngestResult;

// ── bridge → engine ─────────────────────────────────────────────────────────
export const helloFrame = z.object({
  t: z.literal('hello'),
  version: z.number(),
  bridgeVersion: z.string().max(40),
  host: z.string().max(120),
  claude: z.string().max(60).optional(),   // claude code version if detectable
  caps: z.object({ chat: z.boolean() }).loose(),
});
export const evFrame = z.object({ t: z.literal('ev'), sid: z.string(), message: z.unknown() });         // one SDKMessage
export const endFrame = z.object({ t: z.literal('end'), sid: z.string(), error: z.string().optional() }); // stream closed
export const toolCallFrame = z.object({ t: z.literal('tool'), sid: z.string(), id: z.string(), name: z.string().max(80), args: z.unknown() });
export const approvalFrame = z.object({ t: z.literal('approval'), sid: z.string(), id: z.string(), tool: z.string().max(80), input: z.unknown() });
export const pongFrame = z.object({ t: z.literal('pong') });
export const jobResultFrame = z.object({
  t: z.literal('jobResult'), id: z.string(), ok: z.boolean(),
  output: z.unknown().optional(), text: z.string().optional(), error: z.string().optional(),
  usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number().optional() }).optional(),
});
/** A finished coding-session transcript from the watcher (Claude Code / Codex CLI). */
export const ingestFrame = z.object({
  t: z.literal('ingest'), id: z.string(),
  sessionId: z.string().max(200), project: z.string().max(500).optional(),
  source: z.literal('bridge'), jsonl: z.string().max(30_000_000),
});
export const bridgeFrame = z.discriminatedUnion('t', [helloFrame, evFrame, endFrame, toolCallFrame, approvalFrame, pongFrame, jobResultFrame, ingestFrame]);
export type BridgeToEngine = z.infer<typeof bridgeFrame>;
