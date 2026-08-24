/**
 * The colour `segColor` indexes into. Six hues from the Okabe-Ito
 * colour-blind-safe set (dropping black and yellow, the two that read poorly
 * against a board), chosen to stay distinguishable from each other on a
 * small screen. Adjacency itself is the generator's job — greedy colouring
 * never gives two touching segments the same index.
 */
export const PALETTE: readonly string[] = [
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
];

export const PALETTE_SIZE = PALETTE.length;

/** The stroke/fill colour for `segColor`. Throws on an index the palette does not cover. */
export function paletteColor(segColor: number): string {
  if (!Number.isInteger(segColor) || segColor < 0 || segColor >= PALETTE.length) {
    throw new RangeError(`segColor must be an integer in [0, ${PALETTE.length}), got ${segColor}`);
  }
  return PALETTE[segColor] as string;
}
