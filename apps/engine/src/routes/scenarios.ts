/** Blind prediction-test routes (mounted under / from routes/index.ts; internalAuth applies). */
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, clones } from '@opersona/db';
import { createScenarioBatch, openScenarios, historyScenarios, answerScenario, skipScenario, similarity } from '../learning/scenarios.js';
import { correctScenario, CORRECTION_KINDS } from '../learning/scenarioCorrection.js';

export const scenarioRoutes = new Hono();

const parse = async <T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> => schema.parse(await c.req.json().catch(() => ({})));

const cloneInOrg = async (cloneId: string, orgId: string) => {
  const [clone] = await db.select({ id: clones.id }).from(clones).where(and(eq(clones.id, cloneId), eq(clones.orgId, orgId))).limit(1);
  return clone ?? null;
};

/** Generate a batch (each scenario's blind prediction is sealed at creation). */
scenarioRoutes.post('/clones/:id/scenarios', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), count: z.number().int().min(1).max(5).optional() }));
  const clone = await cloneInOrg(c.req.param('id'), body.orgId);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  return c.json(await createScenarioBatch(body.orgId, clone.id, body.count ?? 3));
});

/** view=open serves OPEN_COLUMNS only (the prediction is structurally absent). */
scenarioRoutes.get('/clones/:id/scenarios', async (c) => {
  const orgId = c.req.query('orgId') ?? '';
  const clone = await cloneInOrg(c.req.param('id'), orgId);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const view = c.req.query('view') === 'history' ? 'history' : 'open';
  return c.json({ scenarios: view === 'history' ? await historyScenarios(clone.id) : await openScenarios(clone.id) });
});

scenarioRoutes.post('/clones/:id/scenarios/:sid/answer', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string(), answer: z.string().min(1).max(8000), factors: z.string().max(2000).optional() }));
  const clone = await cloneInOrg(c.req.param('id'), body.orgId);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const r = await answerScenario({ orgId: body.orgId, cloneId: clone.id, id: c.req.param('sid'), answer: body.answer, factors: body.factors });
  if (!r.ok) return c.json({ error: r.error }, r.status as 409);
  return c.json({ scenario: r.scenario });
});

scenarioRoutes.post('/clones/:id/scenarios/:sid/skip', async (c) => {
  const body = await parse(c, z.object({ orgId: z.string(), userId: z.string() }));
  const clone = await cloneInOrg(c.req.param('id'), body.orgId);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const ok = await skipScenario(body.orgId, clone.id, c.req.param('sid'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not an open scenario' }, 404);
});

scenarioRoutes.post('/clones/:id/scenarios/:sid/correct', async (c) => {
  const body = await parse(c, z.object({
    orgId: z.string(), userId: z.string(),
    kinds: z.array(z.enum(CORRECTION_KINDS)).min(1).max(3),
    note: z.string().min(5).max(4000),
  }));
  const clone = await cloneInOrg(c.req.param('id'), body.orgId);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  const r = await correctScenario({ orgId: body.orgId, cloneId: clone.id, scenarioId: c.req.param('sid'), userId: body.userId, kinds: body.kinds, note: body.note });
  return r.ok ? c.json(r) : c.json({ error: r.error }, 409);
});

scenarioRoutes.get('/clones/:id/similarity', async (c) => {
  const orgId = c.req.query('orgId') ?? '';
  const clone = await cloneInOrg(c.req.param('id'), orgId);
  if (!clone) return c.json({ error: 'clone not found' }, 404);
  return c.json(await similarity(clone.id));
});
