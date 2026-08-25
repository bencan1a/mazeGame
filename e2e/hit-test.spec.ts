import { expect, test } from '@playwright/test';
import {
  FIXTURE_BOARD,
  firstFreeSegment,
  fixtureBoard,
  openBoard,
  readCellPixels,
  readCounter,
  readLives,
  restingViewport,
  segmentCells,
  tapCell,
} from './app.js';

test.describe('hit testing', () => {
  test('a tap at a known pixel removes the segment under it, and only that one', async ({
    page,
  }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    const targetId = firstFreeSegment(board);
    const controlId = targetId === 1 ? board.segmentCount : 1;
    expect(controlId).not.toBe(targetId);

    const targetCells = segmentCells(board, targetId);
    const controlCells = segmentCells(board, controlId);
    const aimed = targetCells[Math.floor(targetCells.length / 2)];
    if (aimed === undefined) throw new Error('segment has no cells');

    await openBoard(page, FIXTURE_BOARD);

    const before = await readCellPixels(page, board, [...targetCells, ...controlCells]);
    // The static layer is cleared to transparent, so an occupied cell is
    // exactly one with a non-zero alpha.
    expect(before.every((pixel) => pixel.a > 0)).toBe(true);

    const livesBefore = await readLives(page);
    await tapCell(page, board, aimed.x, aimed.y);

    await expect.poll(async () => (await readCounter(page)).removed).toBe(1);
    await expect
      .poll(async () => (await readCellPixels(page, board, targetCells)).every((p) => p.a === 0))
      .toBe(true);

    const controlAfter = await readCellPixels(page, board, controlCells);
    expect(controlAfter).toEqual(before.slice(targetCells.length));
    expect(await readLives(page)).toBe(livesBefore);
  });
});

// Wider than it is tall, so the fitted square board leaves a margin either
// side with nothing drawn in it.
test.describe('a miss', () => {
  test.use({ viewport: { width: 1200, height: 600 } });

  test('a tap on empty space beyond the radius costs nothing', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    await openBoard(page, FIXTURE_BOARD);

    const surface = await page.locator('.board-surface').boundingBox();
    if (surface === null) throw new Error('board surface has no layout box');
    const viewport = await restingViewport(page, board);
    // Clear of the 24px tap radius by enough that this cannot be a near miss.
    expect(viewport.originX).toBeGreaterThan(32);

    const livesBefore = await readLives(page);
    await page.mouse.click(surface.x + 2, surface.y + surface.height / 2);

    await expect.poll(async () => (await readCounter(page)).removed).toBe(0);
    expect(await readLives(page)).toBe(livesBefore);
  });
});
