/**
 * Selfie → AvatarRecipe via Claude vision with structured output. The image is
 * held in memory only for the duration of this call and is never written to
 * disk or the database — only the resulting recipe is stored.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import sharp from 'sharp';
import { z } from 'zod';
import { AvatarRecipe, SKIN_TONES, HAIR_STYLES, CLOTHES, BROWS, MOUTHS, FACIAL, RGB } from '@opersona/shared';
import { db, sessionCosts } from '@opersona/db';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ensureWorkspace } from '../isolation/workspace.js';
import { sessionEnv } from '../sessions/manager.js';

/** Plain 3-element array instead of a tuple: tuples serialise to draft-specific
 *  keywords (`items: [...]` vs `prefixItems`) and the CLI validator and the API
 *  disagree on drafts; `minItems/maxItems` is valid everywhere. */
const RGB3 = z.array(z.number().int().min(0).max(255)).min(3).max(3);

const Extraction = z.object({
  skin: z.enum(SKIN_TONES),
  hair: z.enum(HAIR_STYLES),
  hairc: RGB3.describe('dominant hair colour as [r,g,b]'),
  part: z.enum(['L', 'R', 'none']),
  cloth: z.enum(CLOTHES),
  c1: RGB3.describe('main garment colour as [r,g,b]'),
  brow: z.enum(BROWS),
  mouth: z.enum(MOUTHS),
  facial: z.enum([...FACIAL, 'none']),
  glasses: z.boolean(),
  lashes: z.boolean().describe('bigger, lashed eyes read as more feminine/expressive — only if that fits the person'),
  heavy: z.boolean().describe('heavier build / rounder face'),
  confidence: z.object({ skin: z.number().min(0).max(1), hair: z.number().min(0).max(1), hairc: z.number().min(0).max(1), cloth: z.number().min(0).max(1), facial: z.number().min(0).max(1), glasses: z.number().min(0).max(1) }),
});

const SYSTEM = `You convert one selfie into parameters for a tiny 18x28-pixel cartoon portrait engine. Pick the CLOSEST option from each enum — the engine can only draw those. Rules:
- skin: choose the palette step (light/tan/brown/dark) that best matches the visible skin tone. This is a drawing palette, not an ethnicity guess.
- hair: styleShort (short, parted), styleFloppy (mid-length floppy fringe), styleFrame (hair framing the face to the jaw or longer), styleBun (tied up), styleCurly (curly/voluminous), styleMessy (tousled), styleRecede (receding hairline), styleSpiky (short spiky), styleBald (bald or shaved).
- hairc / c1: real RGB values sampled from the photo (hair colour, main clothing colour).
- glasses and facial hair only if clearly visible. facial=none when absent. part=none if hair has no visible part or is bald/bun.
- brow/mouth: the resting expression in the photo (smile if smiling).
- Give honest per-field confidence; low confidence is fine — a human edits the result.`;

type Extracted = z.infer<typeof Extraction>;

/** The API requires draft 2020-12 keywords, while Claude Code's own validator rejects
 *  the `$schema` URI tag zod adds. Keep 2020-12, strip the tag, no tuples (see RGB3). */
function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _drop, ...schema } = z.toJSONSchema(Extraction) as Record<string, unknown>;
  return schema;
}

/** Pilot path (no API key): run the same vision prompt through the Agent SDK, which
 *  uses this machine's Claude Code login, with JSON-schema structured output. */
async function extractViaAgentSdk(orgId: string, model: string, jpegB64: string): Promise<Extracted> {
  const ws = ensureWorkspace(orgId, 'avatar');
  const msg: SDKUserMessage = { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegB64 } },
    { type: 'text', text: 'Produce the portrait parameters for this person.' },
  ] } };
  async function* once() { yield msg; }
  let out: unknown;
  for await (const m of query({ prompt: once(), options: {
    model, systemPrompt: SYSTEM, cwd: ws.cwd, env: sessionEnv(ws, null), settingSources: [], tools: [], maxTurns: 2, persistSession: false,
    outputFormat: { type: 'json_schema', schema: extractionJsonSchema() },
  } })) {
    if (m.type === 'result') {
      if (m.subtype !== 'success') throw new Error(`vision call failed: ${m.subtype}`);
      out = m.structured_output;
      await db.insert(sessionCosts).values({ orgId, cloneId: '00000000-0000-0000-0000-000000000000', kind: 'avatar', model, inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, costUsd: m.total_cost_usd }).catch(() => {});
    }
  }
  return Extraction.parse(out);
}

export async function recipeFromSelfie(args: { orgId: string; apiKey: string | null; model: string; imageBase64: string; mime: string }): Promise<{ recipe: AvatarRecipe; confidence: Record<string, number> }> {
  // Normalise: strip EXIF, cap at 512px, re-encode as JPEG — the model never sees the original bytes.
  const input = Buffer.from(args.imageBase64, 'base64');
  const jpeg = await sharp(input).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  let x: Extracted;
  if (!args.apiKey) {
    x = await extractViaAgentSdk(args.orgId, args.model, jpeg.toString('base64'));
  } else {
  const client = new Anthropic({ apiKey: args.apiKey });
  const res = await client.messages.parse({
    model: args.model,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
      { type: 'text', text: 'Produce the portrait parameters for this person.' },
    ] }],
    output_config: { format: zodOutputFormat(Extraction) },
  });
  await db.insert(sessionCosts).values({ orgId: args.orgId, cloneId: '00000000-0000-0000-0000-000000000000', kind: 'avatar', model: args.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }).catch(() => {});
  if (!res.parsed_output) throw new Error('vision model returned no structured output');
  x = res.parsed_output;
  }
  const rgb = (a: number[]): RGB => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
  const recipe: AvatarRecipe = {
    skin: x.skin, hair: x.hair, hairc: rgb(x.hairc), cloth: x.cloth, c1: rgb(x.c1), brow: x.brow, mouth: x.mouth,
    ...(x.part !== 'none' ? { hairargs: { part: x.part } } : {}),
    ...(x.facial !== 'none' ? { facial: x.facial } : {}),
    ...(x.glasses ? { glasses: true } : {}), ...(x.lashes ? { lashes: true } : {}), ...(x.heavy ? { heavy: true } : {}),
  };
  return { recipe: AvatarRecipe.parse(recipe), confidence: x.confidence };
}
