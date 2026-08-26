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
}

const FIXTURE_EDGE = 96;

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
