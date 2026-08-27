/**
 * The phrases the win overlay pops up, and the pick that chooses them.
 * Separated from the component so the choosing is testable without a DOM.
 */

import { wrapIndex } from './homeScreen.js';

export const WIN_PHRASES: readonly string[] = [
  'Way to go!',
  'Nailed it!',
  'Spotless!',
  'Nice untangling!',
  'Clean sweep!',
  'Every piece out!',
  'Masterful!',
  'Too easy?',
  'Puzzle solved!',
  'Smooth moves!',
  'Sharp eyes!',
  'Outstanding!',
  'Not a piece left!',
  'Brilliant!',
  'That was slick!',
  'You cleared it!',
];

function pickFrom(candidates: readonly number[], random: () => number): number {
  const roll = Math.floor(random() * candidates.length);
  const index = Math.min(candidates.length - 1, Math.max(0, roll));
  return candidates[index] as number;
}

export interface WinPhraseChoice {
  /** In pop order, headline first. */
  readonly phrases: readonly string[];
  /** The headline's index, to pass back as `previous` on the next win. */
  readonly headlineIndex: number;
}

/**
 * `count` distinct phrases, none of them the one `previous` names, so two
 * wins in a row never open on the same words. `random` returns a value in
 * [0, 1).
 */
export function pickWinPhrases(
  count: number,
  previous: number | null = null,
  random: () => number = Math.random,
): WinPhraseChoice {
  const wanted = Math.max(1, Math.min(count, WIN_PHRASES.length));
  const taken = new Set<number>();
  if (previous !== null && WIN_PHRASES.length > 1)
    taken.add(wrapIndex(previous, WIN_PHRASES.length));

  const chosen: number[] = [];
  for (let pick = 0; pick < wanted; pick++) {
    const candidates: number[] = [];
    for (let i = 0; i < WIN_PHRASES.length; i++) {
      if (!taken.has(i)) candidates.push(i);
    }
    // Only reachable once every phrase is spoken for, which asking for more
    // than the list holds cannot do.
    if (candidates.length === 0) break;
    const index = pickFrom(candidates, random);
    taken.add(index);
    chosen.push(index);
  }

  return {
    phrases: chosen.map((index) => WIN_PHRASES[index] as string),
    headlineIndex: chosen[0] as number,
  };
}
