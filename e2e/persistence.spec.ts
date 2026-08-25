import { expect, test } from '@playwright/test';
import { BASE_PATH } from '../playwright.config.js';
import {
  FIXTURE_BOARD,
  canvasSignature,
  firstBlockedSegment,
  firstFreeSegment,
  fixtureBoard,
  isCanvasPainted,
  openBoard,
  readCounter,
  readLives,
  readSavedGame,
  tapSegment,
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
    const midGame = await canvasSignature(page);

    // No query string this time: everything the board is built from has to come
    // out of storage, so a save that lost the seed cannot pass.
    await page.goto(BASE_PATH);
    await expect(page.locator('.board-canvas').first()).toBeVisible();
    await expect.poll(() => isCanvasPainted(page)).toBe(true);

    const counter = await readCounter(page);
    expect(counter.total).toBe(board.segmentCount);
    expect(counter.removed).toBe(1);
    expect(await readLives(page)).toBe(startingLives - 1);
    await expect.poll(() => canvasSignature(page)).toBe(midGame);
  });

  test('a fresh browser with no save starts the default board', async ({ page }) => {
    await page.goto(BASE_PATH);
    await expect(page.locator('.board-canvas').first()).toBeVisible();
    await expect.poll(async () => (await readCounter(page)).total).toBeGreaterThan(0);

    const board = fixtureBoard(FIXTURE_BOARD);
    // The fixture is not the default, so its board is proof the query string
    // was the only reason the other tests got it.
    expect((await readCounter(page)).total).not.toBe(board.segmentCount);
  });
});
