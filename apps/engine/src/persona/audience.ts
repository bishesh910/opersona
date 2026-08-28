/** Prompt audiences, resolved from the clone's kind + an optional requested
 *  downgrade. The request can only NARROW privilege, never widen it:
 *  'shared' is the privacy-safe floor for every kind; 'visitor' strips the
 *  owner-only layers from a member clone (a colleague asking). Anything else —
 *  including an attempt to request 'owner' — falls back to the kind default. */
export type PromptAudience = 'owner' | 'visitor' | 'hired' | 'shared' | 'imported';

export function promptAudience(kind: 'member' | 'hired' | 'imported', requested?: string | null): PromptAudience {
  const kindDefault: PromptAudience = kind === 'hired' ? 'hired' : kind === 'imported' ? 'imported' : 'owner';
  if (requested === 'shared') return 'shared';
  if (requested === 'visitor' && kindDefault === 'owner') return 'visitor';
  return kindDefault;
}
