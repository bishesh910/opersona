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
export type EngineToBridge = BridgeStart | BridgeUserMsg | BridgeCancel | BridgeToolResult | BridgeApprovalResult | BridgePing;

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
export const bridgeFrame = z.discriminatedUnion('t', [helloFrame, evFrame, endFrame, toolCallFrame, approvalFrame, pongFrame]);
export type BridgeToEngine = z.infer<typeof bridgeFrame>;
