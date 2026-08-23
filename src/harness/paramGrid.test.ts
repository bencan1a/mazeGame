import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import { cellsFromSingle, cellsFromSweepSpec, defaultCellParams } from './paramGrid.js';

describe('cellsFromSingle', () => {
  it('produces one cell with consecutive seeds starting at seedBase', () => {
    const cells = cellsFromSingle({ seeds: 4, seedBase: 10, overrides: { gridSize: 20 } });
    expect(cells).toHaveLength(1);
    expect(cells[0]?.seeds).toEqual([10, 11, 12, 13]);
  });

  it('fills every field not overridden from DEFAULT_GEN_PARAMS', () => {
    const cells = cellsFromSingle({ overrides: { gridSize: 12 } });
    expect(cells[0]?.params).toEqual({ ...defaultCellParams(), gridSize: 12 });
  });
});

describe('cellsFromSweepSpec', () => {
  it('takes the cartesian product of every array-valued field', () => {
    const cells = cellsFromSweepSpec({
      seeds: 2,
      params: { gridSize: [20, 40], meanPieceLength: [4, 8] },
    });
    expect(cells).toHaveLength(4);
    const pairs = cells.map((c) => [c.params.gridSize, c.params.meanPieceLength]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        [20, 4],
        [20, 8],
        [40, 4],
        [40, 8],
      ]),
    );
  });

  it('treats a scalar field as a single-value axis', () => {
    const cells = cellsFromSweepSpec({ params: { gridSize: [20, 40], fillFraction: 0.5 } });
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect(cell.params.fillFraction).toBe(0.5);
  });

  it('assigns consecutive cellIndex values matching array position', () => {
    const cells = cellsFromSweepSpec({ params: { gridSize: [20, 40, 60] } });
    expect(cells.map((c) => c.cellIndex)).toEqual([0, 1, 2]);
  });

  it('defaults every unspecified field from DEFAULT_GEN_PARAMS', () => {
    const cells = cellsFromSweepSpec({});
    expect(cells).toHaveLength(1);
    expect(cells[0]?.params.gridSize).toBe(DEFAULT_GEN_PARAMS.gridSize);
    expect(cells[0]?.params.fillFraction).toBe(DEFAULT_GEN_PARAMS.fillFraction);
  });

  it('defaults seeds and seedBase when omitted', () => {
    const cells = cellsFromSweepSpec({ params: { gridSize: [20] } });
    expect(cells[0]?.seeds).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});
