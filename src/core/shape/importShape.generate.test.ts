import { describe, expect, it } from 'vitest';
import { generateBoardWithDiagnostics } from '../generate.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { validateBoard } from '../validate/index.js';
import { importShape } from './importShape.js';

const SOURCE_EDGE = 96;

/** Concentric rings: the drawing encloses two faces, one inside the other. */
function ringInk(): Uint8Array {
  const ink = new Uint8Array(SOURCE_EDGE * SOURCE_EDGE);
  const centre = SOURCE_EDGE / 2;
  for (let y = 0; y < SOURCE_EDGE; y++) {
    for (let x = 0; x < SOURCE_EDGE; x++) {
      const radius = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      if (radius > 40 || (radius > 18 && radius < 22)) ink[y * SOURCE_EDGE + x] = 1;
    }
  }
  return ink;
}

describe('a drawing becomes a board', () => {
  it.each([60, 78])(
    'gridSize %i: every face becomes a region and the board validates',
    (gridSize) => {
      const imported = importShape({
        ink: ringInk(),
        sourceWidth: SOURCE_EDGE,
        sourceHeight: SOURCE_EDGE,
        gridSize,
      });
      if (!imported.ok) throw new Error(`import failed: ${imported.reason}`);

      const { board, mask } = generateBoardWithDiagnostics(
        { ...DEFAULT_GEN_PARAMS, gridSize, seed: 5 },
        { silhouette: imported.blob, repair: { holeAreaThreshold: 0 } },
      );

      // Authored art keeps its gaps, so repair must not merge the two rings.
      expect(mask.regionCount).toBe(imported.faceCount);
      expect(board.segmentCount).toBeGreaterThan(0);
      expect(() => validateBoard(board, mask)).not.toThrow();
    },
    30_000,
  );

  it('reports a drawing whose outer contour is open rather than building from it', () => {
    const ink = new Uint8Array(SOURCE_EDGE * SOURCE_EDGE);
    for (let x = 0; x < SOURCE_EDGE; x++) ink[10 * SOURCE_EDGE + x] = 1;

    const imported = importShape({
      ink,
      sourceWidth: SOURCE_EDGE,
      sourceHeight: SOURCE_EDGE,
      gridSize: 60,
    });

    expect(imported.ok).toBe(false);
  });
});
