/**
 * HITL bridge. `canUseTool` (and the ask_human MCP tool) park a Promise here,
 * publish an `approval_request` event, and wait for the web app to POST the
 * resolution. Unanswered requests auto-deny after config.approvalTimeoutMs so a
 * session can never hang forever.
 */
import { eq } from 'drizzle-orm';
import { db, approvals } from '@opersona/db';
import { config } from '../config.js';
import { publish } from './events.js';

export interface Resolution { behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; answer?: string; message?: string }
interface Pending { resolve: (r: Resolution) => void; timer: NodeJS.Timeout; conversationId: string }
const pending = new Map<string, Pending>();

export async function requestApproval(args: {
  orgId: string; cloneId: string; conversationId: string; kind: 'tool' | 'question';
  tool?: string; input?: unknown; question?: string; options?: string[]; signal?: AbortSignal;
}): Promise<Resolution> {
  const [row] = await db.insert(approvals).values({
    orgId: args.orgId, cloneId: args.cloneId, conversationId: args.conversationId, kind: args.kind,
    tool: args.tool ?? null, input: args.input ?? null, question: args.question ?? null, options: args.options ?? null,
  }).returning({ id: approvals.id });
  const id = row!.id;
  publish(args.conversationId, { type: 'approval_request', id, tool: args.tool ?? 'ask_human', input: args.input ?? null, question: args.question, options: args.options });

  return new Promise<Resolution>((resolve) => {
    const finish = async (r: Resolution, status: 'allowed' | 'denied' | 'answered' | 'expired') => {
      const p = pending.get(id); if (!p) return; clearTimeout(p.timer); pending.delete(id);
      await db.update(approvals).set({ status, answer: r.answer ?? null, updatedInput: r.updatedInput ?? null, resolvedAt: new Date() }).where(eq(approvals.id, id)).catch(() => {});
      publish(args.conversationId, { type: 'approval_resolved', id, behavior: r.behavior });
      resolve(r);
    };
    const timer = setTimeout(() => finish({ behavior: 'deny', message: 'owner did not respond in time' }, 'expired'), config.approvalTimeoutMs);
    pending.set(id, { resolve: (r) => finish(r, r.behavior === 'deny' ? 'denied' : args.kind === 'question' ? 'answered' : 'allowed'), timer, conversationId: args.conversationId });
    args.signal?.addEventListener('abort', () => finish({ behavior: 'deny', message: 'session aborted' }, 'expired'), { once: true });
  });
}

export async function resolveApproval(id: string, r: Resolution & { resolvedBy?: string }): Promise<boolean> {
  const p = pending.get(id);
  if (!p) return false;
  if (r.resolvedBy) await db.update(approvals).set({ resolvedBy: r.resolvedBy }).where(eq(approvals.id, id)).catch(() => {});
  p.resolve(r);
  return true;
}
