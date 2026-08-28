/**
 * Simulation — one-shot behavioural predictions: "what would I probably do /
 * say / choose?". NOT chat: context is assembled server-side (retrieval BEFORE
 * the call), output is a structured contract enforced in code, and nothing
 * lands in `conversations` (the learning queue must never mine the persona's
 * own generated text as if the human said it).
 *
 * Anti-invention, code-enforced: the model may only cite evidence ids the
 * server actually retrieved (anything else is dropped); when it says the
 * evidence is thin, the answer is forced to open with the standard abstention.
 */
import { z } from 'zod';
import { db, simulations, type SimulationOutput } from '@opersona/db';
import { structuredCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';
import { activePrompt } from './assemble.js';
import { recallMemory } from './retrieval.js';
import { searchDocuments } from './retrieval.js';

export const SIMULATION_MODES = ['ask', 'respond', 'decide', 'compare', 'explain'] as const;
export type SimulationMode = (typeof SIMULATION_MODES)[number];

export const Simulation = z.object({
  answer: z.string().min(1).max(4000).describe('the likely behaviour: what they would do / the reply they would send / the choice and how they would frame it'),
  factors: z.array(z.object({ factor: z.string().min(2).max(160), weight: z.enum(['major', 'minor']) })).min(1).max(6)
    .describe('THEIR factors, ranked — the reasons this person weighs, not generic pros/cons'),
  confidence: z.number().min(0).max(1).describe('honestly: how well the evidence supports this prediction'),
  uncertainty: z.array(z.string().max(200)).max(4).describe('what the model genuinely does not know here'),
  evidence_used: z.array(z.string().max(80)).max(10).describe('ids from MEMORY EVIDENCE actually relied on — never any other id'),
  enough_information: z.boolean().describe('false when the evidence is too thin for a reliable prediction'),
  comparison: z.array(z.object({ option: z.string().max(200), verdict: z.string().max(300), lean: z.number().min(0).max(1) })).max(4).optional()
    .describe('compare mode only: one verdict per option; lean = probability mass on this option'),
});
export type SimulationT = z.infer<typeof Simulation>;

export const ABSTAIN_PREFIX = "I don't have enough information";

const SIMULATE_CONTRACT = `

SIMULATION TASK — hard contract:
- You are predicting this person's BEHAVIOUR: what they would likely do, say, or choose. This is a behavioural prediction from evidence, never a claim to read their mind.
- Base every factor on the persona above and the MEMORY EVIDENCE list in the request. Those retrieved items are the ONLY memories that exist for this task: cite the ids you relied on in evidence_used, and never reference or invent anything beyond them.
- Consult the "Rules and exceptions" section FIRST: when a rule's situation matches, it governs the prediction.
- factors are THEIR factors, ranked as they would rank them. Answer in their voice and communication style where the mode calls for words.
- Prefer honest abstention over confident guessing: when the evidence is thin, set enough_information=false, keep confidence low, and begin the answer with "${ABSTAIN_PREFIX}".`;

const MODE_TEMPLATE: Record<SimulationMode, (text: string, options?: string[]) => string> = {
  ask: (t) => `What would this person probably do in the following situation?\n\n${t}`,
  respond: (t) => `Draft the reply this person would probably send to the following message, in their voice:\n\n${t}`,
  decide: (t) => `What would this person probably choose here, and how would they arrive at it?\n\n${t}`,
  compare: (t, options) => `Which option would this person probably choose, and why? Give a verdict and a lean for EVERY option in \`comparison\`.\n\n${t ? t + '\n\n' : ''}Options:\n${(options ?? []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}`,
  explain: (t) => `What factors would probably influence this person's decision here, and how heavily?\n\n${t}`,
};

export async function simulate(a: {
  orgId: string; cloneId: string; userId: string; mode: SimulationMode;
  text: string; options?: string[]; context?: string;
}): Promise<{ output: SimulationOutput; evidence: { layer: string; id: string; text: string }[] }> {
  const cfg = await orgModelConfig(a.orgId);
  const { prompt } = await activePrompt(a.orgId, a.cloneId, 'owner');

  // Retrieval happens HERE, before the model sees anything — the frontend never
  // decides what context the model gets.
  const query = [a.text, ...(a.options ?? []), a.context ?? ''].join(' ').slice(0, 500);
  const [hits, docs] = await Promise.all([
    recallMemory(a.cloneId, query, undefined, 10, false).catch(() => []),
    searchDocuments(a.orgId, a.cloneId, query, 4, false).catch(() => []),
  ]);
  const evidence = [
    ...hits.map((h) => ({ layer: h.layer, id: h.id, text: h.text.slice(0, 300) })),
    ...docs.map((d) => ({ layer: 'document', id: d.documentId, text: `${d.filename}: ${d.content.slice(0, 200)}` })),
  ];
  const offered = new Set(evidence.map((e) => e.id));

  const raw = await structuredCall({
    orgId: a.orgId, cloneId: a.cloneId, kind: 'simulate', apiKey: cfg.apiKey, model: cfg.chatModel, effort: 'medium',
    schema: Simulation,
    system: prompt + SIMULATE_CONTRACT,
    user: `${MODE_TEMPLATE[a.mode](a.text, a.options)}${a.context ? `\n\nExtra context from the person: ${a.context}` : ''}\n\nMEMORY EVIDENCE (the only memories that exist for this task):\n${evidence.length ? evidence.map((e) => `[${e.id}] (${e.layer}) ${e.text}`).join('\n') : '(nothing relevant retrieved)'}`,
  });

  const output = enforceContract(raw, offered, a.mode);
  await db.insert(simulations).values({
    orgId: a.orgId, cloneId: a.cloneId, userId: a.userId, mode: a.mode,
    input: { text: a.text, options: a.options, context: a.context },
    output, evidence, model: cfg.chatModel,
  });
  return { output, evidence };
}

/** Pure contract enforcement — testable without a rail. */
export function enforceContract(raw: SimulationT, offered: ReadonlySet<string>, mode: SimulationMode): SimulationOutput {
  const evidence_used = raw.evidence_used.filter((id) => offered.has(id)); // anti-invention: uncited ids vanish
  let answer = raw.answer;
  let enough = raw.enough_information;
  let confidence = raw.confidence;
  if (!enough && !answer.startsWith(ABSTAIN_PREFIX)) {
    answer = `${ABSTAIN_PREFIX} to make a reliable prediction here. My best read, loosely held: ${answer}`;
  }
  if (mode === 'compare' && (!raw.comparison || raw.comparison.length === 0)) {
    // A compare without per-option verdicts is a broken prediction — degrade honestly.
    enough = false;
    confidence = Math.min(confidence, 0.4);
    if (!answer.startsWith(ABSTAIN_PREFIX)) answer = `${ABSTAIN_PREFIX} to weigh the options separately. ${answer}`;
  }
  return {
    answer, factors: raw.factors, confidence, uncertainty: raw.uncertainty,
    evidence_used, enough_information: enough,
    ...(raw.comparison?.length ? { comparison: raw.comparison } : {}),
  };
}
