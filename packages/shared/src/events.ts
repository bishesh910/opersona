/** SSE events the engine streams to the browser for one conversation. */
export type EngineEvent =
  | { type: 'session'; session_id: string }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; text: string; turn_id?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; preview: string }
  | { type: 'approval_request'; id: string; tool: string; input: unknown; question?: string; options?: string[] }
  | { type: 'approval_resolved'; id: string; behavior: 'allow' | 'deny' }
  | { type: 'result'; ok: boolean; cost_usd: number | null; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; error?: string }
  | { type: 'status'; message: string; attempt?: number; max?: number }
  | { type: 'error'; message: string };
