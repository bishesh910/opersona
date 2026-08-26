/** Cafeteria + floor flavour lines (port of the cafeteriaLines.ts idea —
 *  original pools were Office-cast-flavoured; these are opersona's own). */

export const SOLO_LINES: Record<string, string[]> = {
  coffee: [
    'first sip is the whole job', 'decaf is a prank', 'one more cup, then genius',
    'the machine fears me', 'brb, caffeine patch notes',
  ],
  vending: [
    'row C never drops', 'snack-driven development', 'B4 is basically lunch',
    'the coil ate my coin again',
  ],
  table: [
    'lunch is a meeting with myself', 'five more minutes', 'crumbs are a metric',
    'this chair gets me',
  ],
  desk: [
    '…', 'deep in thought', 'tidying my notes', 'almost got it', 'rubber-ducking myself',
    'one more pass', 'ok THAT is interesting',
  ],
  water: ['plants deserve standups too', 'grow, little guy'],
  window: ['nice out there', 'cloud review: approved'],
  dispenser: ['hydration checkpoint', 'cold one. of water.'],
  fridge: ['whose yogurt IS this', 'label your leftovers, people'],
  bin: ['three pointer', 'clean desk, clean mind'],
};

/** Two-beat café exchanges: [speaker A, speaker B, (A again?)]. */
export const PAIR_EXCHANGES: string[][] = [
  ['did you rate your pixie today?', 'it rated ME'],
  ['my persona answered before i could', 'that is the whole point'],
  ['who broke the build?', 'the build broke itself', 'sure it did'],
  ['coffee here keeps improving', 'it is the same machine', 'growth mindset'],
  ['lunch spot ideas?', 'the rug. again'],
  ['i taught mine sarcasm', 'bold. very bold'],
  ['meeting could have been an email', 'email could have been a thought'],
  ['new hairstyle?', 'pixel by pixel, yes'],
];

export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
