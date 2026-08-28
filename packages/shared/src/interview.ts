/**
 * Cognitive interview vocabulary — shared between web and engine.
 *
 * The interview builds a behavioural model of the person across ten life
 * categories. Everything learned from it lands in the knowledge tables
 * (memories / traits / contextual_rules) with an EPISTEMIC TIER that says how
 * we know it: the person plainly said it, we observed it across answers, or
 * we merely suspect it. Tiers never auto-promote.
 */

export const INTERVIEW_CATEGORIES = [
  'identity',
  'values',
  'decision_making',
  'relationships',
  'work',
  'money',
  'emotional',
  'ethics',
  'social',
  'future',
] as const;
export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number];

/** Human labels — plain words, no AI jargon. */
export const CATEGORY_LABEL: Record<InterviewCategory, string> = {
  identity: 'Who you are',
  values: 'What matters to you',
  decision_making: 'How you decide',
  relationships: 'People close to you',
  work: 'Work',
  money: 'Money',
  emotional: 'Feelings',
  ethics: 'Right and wrong',
  social: 'Around others',
  future: 'Where you’re headed',
};

/** Follow-up intents an interviewer can hang on an answer. */
export const FOLLOWUP_INTENTS = [
  'why',
  'alternatives',
  'what_mattered',
  'would_you_today',
  'exception',
  'close_person',
] as const;
export type FollowupIntent = (typeof FOLLOWUP_INTENTS)[number];

/** How we know a knowledge item: said outright / observed across answers / suspected. */
export const EPISTEMIC_TIERS = ['explicit', 'inferred', 'hypothesis'] as const;
export type EpistemicTier = (typeof EPISTEMIC_TIERS)[number];

/** Plain-words labels for tiers (UI). */
export const TIER_LABEL: Record<EpistemicTier, string> = {
  explicit: 'you said this',
  inferred: 'observed',
  hypothesis: 'hunch',
};

export const TRAIT_KINDS = ['value', 'belief', 'preference', 'behaviour', 'decision_pattern'] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];

export type InterviewQuestionKind = 'behavioural' | 'follow_up' | 'contradiction';
export type InterviewQuestionSource = 'bank' | 'generated' | 'triage';
export type InterviewQuestionStatus = 'pending' | 'asked' | 'answered' | 'skipped' | 'retired';
export type AnswerExtractionStatus = 'pending' | 'done' | 'failed' | 'skipped';
export type ContradictionStatus = 'open' | 'probed' | 'resolved' | 'dismissed';

/** Confidence ceilings per tier — code-enforced, not prompt-hoped. */
export const TIER_CONFIDENCE_CAP: Record<EpistemicTier, number> = {
  explicit: 0.95,
  inferred: 0.85,
  hypothesis: 0.6,
};
