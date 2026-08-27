/** Engine-local re-exports for the bridge protocol (shared package owns the wire shapes). */
export { bridgeFrame, BRIDGE_PROTOCOL_VERSION } from '@opersona/shared';
export type { BridgeToEngine, EngineToBridge, BridgeStart } from '@opersona/shared';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
/** SDK messages arrive as JSON over the wire — structurally SDKMessage, minus class identity. */
export type SDKishMessage = SDKMessage;
