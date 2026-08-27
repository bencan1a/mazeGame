import { describe, expect, it } from 'vitest';
import { WIN_PHRASES, pickWinPhrases } from './celebration.js';

/** Cycles the given rolls, so a test fixes exactly which phrases come out. */
function rolls(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] as number;
}

describe('WIN_PHRASES', () => {
  it('offers enough distinct, non-empty phrases to fill a burst', () => {
    expect(WIN_PHRASES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(WIN_PHRASES).size).toBe(WIN_PHRASES.length);
    expect(WIN_PHRASES.every((phrase) => phrase.trim().length > 0)).toBe(true);
  });
});

describe('pickWinPhrases', () => {
  it('picks as many distinct phrases as asked for', () => {
    const { phrases } = pickWinPhrases(3, null, rolls(0.1, 0.5, 0.9));
    expect(phrases).toHaveLength(3);
    expect(new Set(phrases).size).toBe(3);
  });

  it('takes the first phrase from the front of the list on a zero roll', () => {
    const { phrases, headlineIndex } = pickWinPhrases(1, null, rolls(0));
    expect(phrases[0]).toBe(WIN_PHRASES[0]);
    expect(headlineIndex).toBe(0);
  });

  it('stays inside the list on a roll at the very top of the range', () => {
    const { phrases } = pickWinPhrases(2, null, rolls(0.999999999));
    expect(WIN_PHRASES).toContain(phrases[0] as string);
    expect(WIN_PHRASES).toContain(phrases[1] as string);
  });

  it('never repeats the previous win headline', () => {
    const first = pickWinPhrases(3, null, rolls(0));
    for (let attempt = 0; attempt < WIN_PHRASES.length; attempt++) {
      const roll = attempt / WIN_PHRASES.length;
      const next = pickWinPhrases(3, first.headlineIndex, rolls(roll));
      expect(next.phrases).not.toContain(WIN_PHRASES[first.headlineIndex] as string);
    }
  });

  it('reports the headline index it picked, ready to pass back', () => {
    const choice = pickWinPhrases(3, null, rolls(0.5, 0.1, 0.9));
    expect(WIN_PHRASES[choice.headlineIndex]).toBe(choice.phrases[0]);
  });

  it('asks for at least one phrase however few are wanted', () => {
    expect(pickWinPhrases(0, null, rolls(0.2)).phrases).toHaveLength(1);
    expect(pickWinPhrases(-4, null, rolls(0.2)).phrases).toHaveLength(1);
  });

  it('never asks for more phrases than the list holds', () => {
    const { phrases } = pickWinPhrases(WIN_PHRASES.length + 5, null, rolls(0.3, 0.7, 0.1));
    expect(phrases).toHaveLength(WIN_PHRASES.length);
    expect(new Set(phrases).size).toBe(WIN_PHRASES.length);
  });

  it('wraps a previous index from outside the list rather than dropping it', () => {
    const { phrases } = pickWinPhrases(2, WIN_PHRASES.length, rolls(0));
    expect(phrases).not.toContain(WIN_PHRASES[0] as string);
  });

  it('varies with the rolls it is given', () => {
    const a = pickWinPhrases(3, null, rolls(0.1));
    const b = pickWinPhrases(3, null, rolls(0.8));
    expect(a.phrases).not.toEqual(b.phrases);
  });
});
