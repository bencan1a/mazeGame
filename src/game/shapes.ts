/**
 * The library the home screen browses. Real shapes arrive as a baked asset the
 * build produces; until then `createFixtureLibrary` draws a few so the screen
 * has something to show and the format has something to be tested against.
 */

export interface ShapeSummary {
  readonly id: string;
  /** What a player is shown. "Moped", not "moped-front". */
  readonly name: string;
}

/** The drawing as it was drawn: vector, so it stays smooth at any size. */
export interface ShapeOutline {
  /** SVG path data, filled with the nonzero rule so its holes stay holes. */
  readonly path: string;
  /** Edge of the square the path's coordinates are in. */
  readonly viewBox: number;
}

export interface ShapeLibrary {
  readonly shapes: readonly ShapeSummary[];
  /** Edge length of every bitmap `ink` returns. */
  readonly edge: number;
  /**
   * The drawing, one byte per cell, 1 where the ink is. The strokes are the
   * drawing and stay empty on the board; the enclosed faces between them
   * become the lobes.
   */
  ink(id: string): Uint8Array | null;
  /**
   * The artwork the bitmap was rasterised from. The board is cut from the
   * bitmap, but showing a player the bitmap would show them the rasteriser's
   * staircase rather than the drawing.
   */
  outline(id: string): ShapeOutline | null;
}

const FIXTURE_EDGE = 96;

/**
 * The same drawings as vector paths. A hole winds against the outline around
 * it, since these are filled with the nonzero rule the real artwork needs: a
 * subpath wound the same way as its container unions with it instead, and the
 * drawing comes out as a solid block.
 */
const FIXTURE_OUTLINES: Readonly<Record<string, string>> = {
  ring: 'M48 8A40 40 0 1 0 48 88A40 40 0 1 0 48 8ZM48 28A20 20 0 1 1 48 68A20 20 0 1 1 48 28Z',
  house: 'M0 0H96V96H0ZM8 8V88H88V8ZM8 40H88V45H8ZM40 45H45V88H40Z',
  window: 'M10 10H86V86H10ZM16 16V80H80V16ZM16 45H80V51H16ZM45 16H51V80H45Z',
};

export function createFixtureLibrary(): ShapeLibrary {
  const drawings: readonly (readonly [ShapeSummary, Uint8Array])[] = [
    [{ id: 'ring', name: 'Ring' }, ring()],
    [{ id: 'house', name: 'House' }, house()],
    [{ id: 'window', name: 'Window' }, window4()],
  ];
  const byId = new Map(drawings.map(([summary, ink]) => [summary.id, ink]));
  return {
    shapes: drawings.map(([summary]) => summary),
    edge: FIXTURE_EDGE,
    ink: (id) => byId.get(id) ?? null,
    outline(id) {
      const path = FIXTURE_OUTLINES[id];
      return path === undefined ? null : { path, viewBox: FIXTURE_EDGE };
    },
  };
}

function blank(): Uint8Array {
  return new Uint8Array(FIXTURE_EDGE * FIXTURE_EDGE);
}

function strokeRect(
  ink: Uint8Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
): void {
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const onEdge = x - left < width || right - x < width || y - top < width || bottom - y < width;
      if (onEdge) ink[y * FIXTURE_EDGE + x] = 1;
    }
  }
}

function strokeLine(
  ink: Uint8Array,
  from: number,
  to: number,
  at: number,
  width: number,
  vertical: boolean,
): void {
  for (let along = from; along <= to; along++) {
    for (let across = at; across < at + width; across++) {
      const x = vertical ? across : along;
      const y = vertical ? along : across;
      ink[y * FIXTURE_EDGE + x] = 1;
    }
  }
}

function ring(): Uint8Array {
  const ink = blank();
  const centre = FIXTURE_EDGE / 2;
  for (let y = 0; y < FIXTURE_EDGE; y++) {
    for (let x = 0; x < FIXTURE_EDGE; x++) {
      const radius = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      if (radius > 40 || (radius > 18 && radius < 22)) ink[y * FIXTURE_EDGE + x] = 1;
    }
  }
  return ink;
}

function house(): Uint8Array {
  const ink = blank();
  strokeRect(ink, 0, 0, FIXTURE_EDGE - 1, FIXTURE_EDGE - 1, 8);
  strokeLine(ink, 8, FIXTURE_EDGE - 9, 40, 5, false);
  strokeLine(ink, 40, FIXTURE_EDGE - 9, 44, 5, true);
  return ink;
}

function window4(): Uint8Array {
  const ink = blank();
  strokeRect(ink, 10, 10, FIXTURE_EDGE - 11, FIXTURE_EDGE - 11, 6);
  strokeLine(ink, 10, FIXTURE_EDGE - 11, 45, 6, false);
  strokeLine(ink, 10, FIXTURE_EDGE - 11, 45, 6, true);
  return ink;
}
