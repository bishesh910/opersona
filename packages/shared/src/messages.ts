/**
 * FIPA-lite inter-clone message schema: the one useful idea from FIPA-ACL/KQML
 * is the speech act.
 *
 * Anti-livelock rules (enforced by the router, not the model):
 *  - only request / query / propose obligate a reply; inform / done are terminal
 *  - every reply increments `hops`; past HOP_CAP the router sets needs_human
 *  - re-seeing a processed id is a no-op (idempotent via inbox cursor)
 */
import { z } from 'zod';

export const MessageAct = z.enum(['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done']);
export type MessageAct = z.infer<typeof MessageAct>;

export const HOP_CAP = 6;

export const CloneMessage = z.object({
  id: z.string(),
  conversation: z.string(),
  in_reply_to: z.string().nullable(),
  from: z.string(),
  to: z.string(), // clone id | 'broadcast'
  act: MessageAct,
  subject: z.string().max(200),
  body: z.string(),
  hops: z.number().int().min(0),
  requires_reply: z.boolean(),
  needs_human: z.boolean(),
  created_at: z.string(),
});
export type CloneMessage = z.infer<typeof CloneMessage>;

export const REPLY_OBLIGATING: ReadonlySet<MessageAct> = new Set(['request', 'query', 'propose']);
export function obligatesReply(act: MessageAct): boolean { return REPLY_OBLIGATING.has(act); }
