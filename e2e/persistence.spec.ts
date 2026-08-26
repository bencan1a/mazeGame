import { expect, test } from '@playwright/test';
import { BASE_PATH } from '../playwright.config.js';
import {
  FIXTURE_BOARD,
  canvasSignature,
  settledCanvasSignature,
  firstBlockedSegment,
  firstFreeSegment,
  fixtureBoard,
  isCanvasPainted,
  openBoard,
  readCounter,
  readLives,
  readSavedGame,
  tapSegment,
  waitForIntro,
} from './app.js';

test.describe('persistence', () => {
  test('seed, params, removed segments and lives survive a reload', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    const free = firstFreeSegment(board);
    const blocked = firstBlockedSegment(board, [free]);

    await openBoard(page, FIXTURE_BOARD);

    const startingLives = await readLives(page);
    await tapSegment(page, board, free);
    await expect.poll(async () => (await readCounter(page)).removed).toBe(1);
    await tapSegment(page, board, blocked);
    await expect.poll(() => readLives(page)).toBe(startingLives - 1);

    await expect
      .poll(async () => (await readSavedGame(page))?.value.removedSegments)
      .toEqual([free]);
    await expect
      .poll(async () => (await readSavedGame(page))?.value.bouncedSegments)
      .toEqual([blocked]);
    const midGame = await settledCanvasSignature(page);

    // No query string this time: everything the board is built from has to come
    // out of storage, so a save that lost the seed cannot pass.
    await page.goto(BASE_PATH);
    await expect(page.locator('.board-canvas').first()).toBeVisible();
    await waitForIntro(page);
    await expect.poll(() => isCanvasPainted(page)).toBe(true);

    const counter = await readCounter(page);
    expect(counter.total).toBe(board.segmentCount);
    expect(counter.removed).toBe(1);
    expect(await readLives(page)).toBe(startingLives - 1);
    await expect.poll(() => canvasSignature(page)).toBe(midGame);
  });

  test('a fresh browser with no save opens the home screen, not a board', async ({ page }) => {
    await page.goto(BASE_PATH);
    await expect(page.locator('.home-screen')).toBeVisible();
    // No board at all is what proves the query string was the only reason the
    // other tests got the fixture one.
    await expect(page.locator('.board-canvas')).toHaveCount(0);
  });
});
