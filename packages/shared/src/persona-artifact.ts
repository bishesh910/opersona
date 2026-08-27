/**
 * `opersona/persona@1` — the portable, privacy-safe persona artifact.
 *
 * This is the ONLY shape that leaves a workspace: publishing snapshots one,
 * importing materializes one, and the file download/upload roundtrip carries
 * one between opersona instances. Privacy-safe BY CONSTRUCTION: the schema has
 * no fields for evidence quotes, episodes, lessons, autonomy, org names,
 * document filenames or emails — a leak would need a schema change, not a bug.
 *
 * Distinct from `opersona/persona-full@1`, the owner's private backup export
 * (which carries everything, including evidence).
 */
import { z } from 'zod';
import { AvatarRecipe } from './avatar.js';

export const PERSONA_ARTIFACT_SPEC = 'opersona/persona@1';

export const ARTIFACT_CAPS = {
  patterns: 80,
  facts: 200,
  playbooks: 50,
  promptChars: 32_000,
  totalBytes: 300_000,
} as const;

const Line = (max: number) => z.string().min(1).max(max);

export const ArtifactPattern = z.object({
  key: Line(120),
  dimension: Line(40),
  description: Line(600),
  strength: z.number().min(0).max(1).optional(),
});

export const ArtifactFact = z.object({
  statement: Line(600),
  domain: z.string().max(80).nullish(),
});

export const ArtifactPlaybookStep = z.object({
  n: z.number().int().min(0),
  action: Line(1000),
  command: z.string().max(1000).optional(),
  check: z.string().max(1000).optional(),
  expected: z.string().max(1000).optional(),
  if_not: z.string().max(1000).optional(),
});

export const ArtifactPlaybook = z.object({
  name: Line(200),
  domain: z.string().max(80).nullish(),
  trigger: Line(500),
  preconditions: z.array(z.string().max(500)).max(20).default([]),
  steps: z.array(ArtifactPlaybookStep).max(40).default([]),
  pitfalls: z.array(z.string().max(500)).max(20).default([]),
});

export const PersonaArtifact = z.object({
  spec: z.literal(PERSONA_ARTIFACT_SPEC),
  version: z.number().int().min(1),
  publishedAt: z.string().max(40),
  persona: z.object({
    name: Line(80),
    roleTitle: z.string().max(200).nullish(),
    bio: z.string().max(500).nullish(),
    avatarRecipe: AvatarRecipe.nullish(),
    personality: z.object({ type: Line(8), scores: z.record(z.string(), z.number()) }).nullish(),
  }),
  author: z.object({
    name: Line(80),
    slug: z.string().max(80).nullish(),
    site: z.string().max(200),
  }),
  stats: z.object({
    patterns: z.number().int().min(0),
    facts: z.number().int().min(0),
    playbooks: z.number().int().min(0),
    accuracy: z.number().min(0).max(1).nullish(),
  }),
  thinking: z.array(ArtifactPattern).max(ARTIFACT_CAPS.patterns),
  facts: z.array(ArtifactFact).max(ARTIFACT_CAPS.facts),
  playbooks: z.array(ArtifactPlaybook).max(ARTIFACT_CAPS.playbooks),
  systemPrompt: Line(ARTIFACT_CAPS.promptChars),
});
export type PersonaArtifact = z.infer<typeof PersonaArtifact>;

/** Parse + size-cap an untrusted artifact (file upload, cross-instance import). */
export function parsePersonaArtifact(raw: unknown): { ok: true; artifact: PersonaArtifact } | { ok: false; error: string } {
  try {
    if (JSON.stringify(raw).length > ARTIFACT_CAPS.totalBytes) return { ok: false, error: `artifact exceeds ${ARTIFACT_CAPS.totalBytes / 1000}KB` };
  } catch {
    return { ok: false, error: 'not serializable JSON' };
  }
  const r = PersonaArtifact.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, error: `not a valid opersona persona file (${i ? `${i.path.join('.')}: ${i.message}` : 'schema mismatch'})` };
  }
  return { ok: true, artifact: r.data };
}
