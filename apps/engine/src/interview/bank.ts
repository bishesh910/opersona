/**
 * The authored question bank — the interview's cold-start fuel. Behavioural
 * questions ("tell me about the last time…"), never trait quizzes ("are you a
 * risk taker?"): a real remembered moment carries evidence; a self-label
 * carries almost none. Ten categories × five facets, one opener per facet.
 *
 * Pure data: the picker materializes rows from here with zero LLM calls, so a
 * brand-new persona can be interviewed the second it exists.
 */
import type { InterviewCategory } from '@opersona/shared';

export interface BankQuestion {
  bankKey: string;
  category: InterviewCategory;
  facet: string;
  text: string;
  hint?: string;
  /** Disclosure weight — the picker escalates gradually (McAdams-style): low
   *  opens the interview, high (regret/loss/shame/fear) waits until trust is
   *  earned (~10 answers). Default medium. */
  intensity?: 'low' | 'medium' | 'high';
}

export const CATEGORY_FACETS: Record<InterviewCategory, string[]> = {
  identity: ['self_image', 'origins', 'turning_points', 'roles', 'self_vs_others'],
  values: ['named_values', 'value_in_action', 'sacrifices', 'priorities_conflict', 'drift_over_time'],
  decision_making: ['big_decision_process', 'information_gathering', 'gut_vs_analysis', 'regret_and_revision', 'pressure'],
  relationships: ['closeness', 'conflict', 'trust', 'support_give_take', 'boundaries'],
  work: ['motivation', 'collaboration', 'ambition', 'feedback', 'failure_recovery',
    // craft: how they actually DO the work, not just how they feel about it
    'craft_method', 'debugging', 'shipping_bar', 'learning_new'],
  money: ['spending', 'saving', 'risk', 'money_meaning', 'generosity_dependence'],
  emotional: ['stress_response', 'joy', 'anger', 'coping', 'expression'],
  ethics: ['fairness', 'honesty', 'rule_breaking', 'dilemmas', 'hard_lines'],
  social: ['group_role', 'social_battery', 'strangers', 'reputation', 'belonging'],
  future: ['aspirations', 'fears', 'planning_horizon', 'change_appetite', 'legacy'],
};

const q = (bankKey: string, category: InterviewCategory, facet: string, text: string, hint?: string): BankQuestion =>
  ({ bankKey, category, facet, text, hint });

const RAW: BankQuestion[] = [
  // ── identity ──────────────────────────────────────────────────────────────
  q('identity.self_image.1', 'identity', 'self_image',
    'How would the people closest to you describe you in a few sentences — and where would they be slightly wrong?',
    'The "slightly wrong" part is usually the interesting half.'),
  q('identity.origins.1', 'identity', 'origins',
    'Tell me about something from where or how you grew up that still shapes how you live now.',
    'A place, a habit, a rule of the house — anything that stuck.'),
  q('identity.turning_points.1', 'identity', 'turning_points',
    'Tell me about a moment that split your life into a before and an after. What actually changed?',
    'Big or quiet — a move, a person, a decision, a loss.'),
  q('identity.roles.1', 'identity', 'roles',
    'What role do you tend to end up playing in the groups you belong to — family, friends, work? Give me a recent example of you in that role.',
    'The fixer, the planner, the peacemaker, the one who says the uncomfortable thing…'),
  q('identity.self_vs_others.1', 'identity', 'self_vs_others',
    'What is something people consistently expect of you that does not match who you actually are?'),

  // ── values ────────────────────────────────────────────────────────────────
  q('values.named_values.1', 'values', 'named_values',
    'If you had to name the two or three things you refuse to compromise on, what are they — and when did each one last actually cost you something?',
    'A value that never costs anything is usually a slogan.'),
  q('values.value_in_action.1', 'values', 'value_in_action',
    'Tell me about a recent time you did the harder thing because it felt right. What made it non-negotiable?'),
  q('values.sacrifices.1', 'values', 'sacrifices',
    'What have you given up on purpose — a job, a habit, a relationship, money — because keeping it clashed with something more important?'),
  q('values.priorities_conflict.1', 'values', 'priorities_conflict',
    'Tell me about a time two things you care about pulled in opposite directions. Which side won, and how did you pick?',
    'Family vs work, honesty vs kindness, freedom vs security…'),
  q('values.drift_over_time.1', 'values', 'drift_over_time',
    'What mattered a lot to you five or ten years ago that matters less now? What changed it?'),

  // ── decision_making ───────────────────────────────────────────────────────
  q('decision_making.big_decision_process.1', 'decision_making', 'big_decision_process',
    'Walk me through the last big decision you made — from the moment it appeared to the moment you committed. What did you actually do, in order?',
    'The messy real version, not the tidy retelling.'),
  q('decision_making.information_gathering.1', 'decision_making', 'information_gathering',
    'When you face something unfamiliar and important, what do you reach for first — people, reading, trying it, sleeping on it? Tell me about the last time.'),
  q('decision_making.gut_vs_analysis.1', 'decision_making', 'gut_vs_analysis',
    'Tell me about a time your gut said one thing and the analysis said another. Which did you follow, and how did it turn out?'),
  q('decision_making.regret_and_revision.1', 'decision_making', 'regret_and_revision',
    'What decision would you most like to take back? Knowing only what you knew then, would you actually have decided differently?'),
  q('decision_making.pressure.1', 'decision_making', 'pressure',
    'Tell me about a decision you had to make fast, under real pressure. What did you cut from your normal process — and did it cost you?'),

  // ── relationships ─────────────────────────────────────────────────────────
  q('relationships.closeness.1', 'relationships', 'closeness',
    'Think of the person you feel closest to. What do you do together or for each other that makes it THAT relationship?'),
  q('relationships.conflict.1', 'relationships', 'conflict',
    'Tell me about your last real disagreement with someone you care about. What did you do while it was hot — and after?'),
  q('relationships.trust.1', 'relationships', 'trust',
    'How does someone earn your trust — and tell me about a time someone lost it. Did they ever get it back?'),
  q('relationships.support_give_take.1', 'relationships', 'support_give_take',
    'When life gets heavy, who do you actually tell — and how long do you wait before telling them? When did you last ask someone for real help?'),
  q('relationships.boundaries.1', 'relationships', 'boundaries',
    'Tell me about a time you had to draw a line with someone close to you. How did you say it, and what happened?'),

  // ── work ──────────────────────────────────────────────────────────────────
  q('work.motivation.1', 'work', 'motivation',
    'Describe a stretch of work you loved so much you lost track of time. What exactly made it feel that way?'),
  q('work.collaboration.1', 'work', 'collaboration',
    'Tell me about the best team you were ever part of — and the worst. What did YOU do differently in each?'),
  q('work.ambition.1', 'work', 'ambition',
    'Tell me about a time you turned down (or chased) more responsibility. What tipped the choice?'),
  q('work.feedback.1', 'work', 'feedback',
    'Tell me about the most useful criticism you ever received. What made it land instead of sting?'),
  q('work.failure_recovery.1', 'work', 'failure_recovery',
    'Tell me about a work failure that was genuinely yours. What did you do in the first 48 hours — and what do you do differently now?'),

  q('work.craft_method.1', 'work', 'craft_method',
    'Take something you are genuinely good at. Walk me through how you actually do it — the real sequence, including the step other people skip.',
    'The part you would insist on even under time pressure.'),
  q('work.debugging.1', 'work', 'debugging',
    'Think of the last thing that broke and made no sense. What did you check first, and what did you refuse to do until you understood it?'),
  q('work.shipping_bar.1', 'work', 'shipping_bar',
    'What has to be true before you call something finished and hand it over? Tell me about a time you shipped anyway — and one where you refused.'),
  q('work.learning_new.1', 'work', 'learning_new',
    'When you had to learn something hard recently, how did you actually go about it — and how did you know you had it?'),

  // ── money ─────────────────────────────────────────────────────────────────
  q('money.spending.1', 'money', 'spending',
    'What was your last purchase that others might call unreasonable but you would defend? Why was it worth it to you?'),
  q('money.saving.1', 'money', 'saving',
    'How do you handle money you don’t immediately need? Tell me what you actually did with the last unexpected sum that came your way.'),
  q('money.risk.1', 'money', 'risk',
    'Tell me about the biggest financial risk you ever took — or the one you deliberately walked away from. What decided it?'),
  q('money.money_meaning.1', 'money', 'money_meaning',
    'What does having "enough" look like for you, concretely? Has that number or picture changed?'),
  q('money.generosity_dependence.1', 'money', 'generosity_dependence',
    'Tell me about a time money moved between you and someone close — lending, borrowing, being supported, supporting. How did it feel, and what rule did you take from it?'),

  // ── emotional ─────────────────────────────────────────────────────────────
  q('emotional.stress_response.1', 'emotional', 'stress_response',
    'Think of your most stressful week in recent memory. What did the people around you see — and what was happening inside that they didn’t?'),
  q('emotional.joy.1', 'emotional', 'joy',
    'When did you last feel properly light — joyful for no strategic reason? What were you doing?'),
  q('emotional.anger.1', 'emotional', 'anger',
    'Tell me about the last time you were genuinely angry. What did you do in the moment — and how long did it stay with you?'),
  q('emotional.coping.1', 'emotional', 'coping',
    'When something knocks you down, what is your honest first move — the thing you actually do, not the thing you recommend to others?'),
  q('emotional.expression.1', 'emotional', 'expression',
    'Which feeling is hardest for you to show to others? Tell me about a time you hid it — or finally didn’t.'),

  // ── ethics ────────────────────────────────────────────────────────────────
  q('ethics.fairness.1', 'ethics', 'fairness',
    'Tell me about a time you watched something unfair happen. What did you do — and if you stayed quiet, what held you back?'),
  q('ethics.honesty.1', 'ethics', 'honesty',
    'When is a lie acceptable to you, if ever? Tell me about a real moment you faced exactly that.'),
  q('ethics.rule_breaking.1', 'ethics', 'rule_breaking',
    'Tell me about a rule you deliberately broke because you thought it was wrong or pointless. Would you break it again?'),
  q('ethics.dilemmas.1', 'ethics', 'dilemmas',
    'Describe a genuinely hard call you had to make where every option hurt someone or something. How did you choose?'),
  q('ethics.hard_lines.1', 'ethics', 'hard_lines',
    'What would you never do, no matter the payoff — and has that line ever actually been tested?'),

  // ── social ────────────────────────────────────────────────────────────────
  q('social.group_role.1', 'social', 'group_role',
    'Picture the last gathering you were at with more than a handful of people. Where were you in the room and what were you doing?'),
  q('social.social_battery.1', 'social', 'social_battery',
    'After a long stretch with people, what state are you in — and what do you do next? Tell me about the last time.'),
  q('social.strangers.1', 'social', 'strangers',
    'Tell me about a recent interaction with a total stranger that went beyond the transactional. Who started it?'),
  q('social.reputation.1', 'social', 'reputation',
    'Tell me about a time you did something unpopular in front of people whose opinion mattered to you. What did it cost?'),
  q('social.belonging.1', 'social', 'belonging',
    'Where do you feel most like you belong — and tell me about a place or group where you clearly didn’t. What was the difference?'),

  // ── future ────────────────────────────────────────────────────────────────
  q('future.aspirations.1', 'future', 'aspirations',
    'If the next five years went genuinely well — by your own measure, nobody else’s — what would be true that isn’t true today?'),
  q('future.fears.1', 'future', 'fears',
    'What about the future actually worries you when it’s late and you’re honest with yourself? What, if anything, are you doing about it?'),
  q('future.planning_horizon.1', 'future', 'planning_horizon',
    'How far ahead do you really plan? Tell me about the furthest-ahead commitment you’ve made and how it felt to make it.'),
  q('future.change_appetite.1', 'future', 'change_appetite',
    'Tell me about the last big change you chose on purpose — new place, new path, new person gone or arrived. What tipped you from thinking to doing?'),
  q('future.legacy.1', 'future', 'legacy',
    'When people who knew you talk about you years from now, what do you hope they say — and what are you doing now that supports it?'),

  // ── warm-ups + narrative identity (McAdams reference) ─────────────────────
  q('identity.self_image.2', 'identity', 'self_image',
    'Walk me through your last ordinary day, roughly hour by hour — what did you actually do, and which part did you quietly look forward to?',
    'The boring version is the revealing one.'),
  q('emotional.coping.2', 'emotional', 'coping',
    'What do you do when you’re bored and nothing is scheduled? Tell me about the last time that actually happened.'),
  q('work.motivation.2', 'work', 'motivation',
    'What’s the last thing you finished that nobody made you finish? What kept you going past the point where quitting was free?'),
  q('emotional.joy.2', 'emotional', 'joy',
    'Tell me about a genuine high point — a specific scene you’d point to if asked when life felt most right. Where were you, who was there?'),
  q('identity.origins.2', 'identity', 'origins',
    'Tell me one vivid scene from your childhood — a specific moment you can still see. Where were you, who was there, what happened?'),
  q('identity.turning_points.2', 'identity', 'turning_points',
    'If your life so far were a book, what would the chapters be called? Just the titles — then tell me which chapter surprised you most to live through.'),
];

/** Disclosure weights: low = safe openers, high = regret / loss / shame / fear
 *  territory the picker holds back until ~10 answers. Unlisted = medium. */
const INTENSITY: Record<string, 'low' | 'high'> = {
  // low — warm-up-safe
  'identity.self_image.2': 'low',
  'emotional.coping.2': 'low',
  'work.motivation.2': 'low',
  'emotional.joy.2': 'low',
  'emotional.joy.1': 'low',
  'work.motivation.1': 'low',
  'social.group_role.1': 'low',
  'social.social_battery.1': 'low',
  'social.strangers.1': 'low',
  'decision_making.information_gathering.1': 'low',
  'money.spending.1': 'low',
  'future.planning_horizon.1': 'low',
  // high — heavy disclosure
  'decision_making.regret_and_revision.1': 'high',
  'ethics.dilemmas.1': 'high',
  'emotional.anger.1': 'high',
  'emotional.stress_response.1': 'high',
  'emotional.expression.1': 'high',
  'future.fears.1': 'high',
  'work.failure_recovery.1': 'high',
  'identity.turning_points.1': 'high',
  'money.generosity_dependence.1': 'high',
  'values.sacrifices.1': 'high',
};

export const BANK: BankQuestion[] = RAW.map((b) => ({ ...b, intensity: INTENSITY[b.bankKey] ?? 'medium' }));

/** Fast lookups. */
export const BANK_BY_KEY: ReadonlyMap<string, BankQuestion> = new Map(BANK.map((b) => [b.bankKey, b]));
export function bankFor(category: InterviewCategory): BankQuestion[] {
  return BANK.filter((b) => b.category === category);
}
