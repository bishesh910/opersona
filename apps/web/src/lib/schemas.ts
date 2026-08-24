import { z } from 'zod';

const uuid = z.string().uuid();

export const PlaybookStepInput = z.object({
  action: z.string().trim().min(1).max(1000),
  command: z.string().trim().max(1000).optional(),
  check: z.string().trim().max(1000).optional(),
  expected: z.string().trim().max(1000).optional(),
  if_not: z.string().trim().max(1000).optional(),
});
export const PlaybookInput = z.object({
  cloneId: uuid,
  id: uuid.optional(),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(80).optional(),
  trigger: z.string().trim().min(1).max(1000),
  preconditions: z.array(z.string().trim().min(1).max(500)).max(50),
  steps: z.array(PlaybookStepInput).min(1).max(100),
  pitfalls: z.array(z.string().trim().min(1).max(500)).max(50),
  shareable: z.boolean().optional(),
});
export type PlaybookInput = z.infer<typeof PlaybookInput>;
