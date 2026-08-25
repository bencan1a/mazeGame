import { expect, test } from '@playwright/test';
import {
  FIXTURE_BOARD,
  canvasSignature,
  clearingOrder,
  firstBlockedSegment,
  firstFreeSegment,
  fixtureBoard,
  openBoard,
  readCounter,
  readLives,
  readSavedGame,
  settledCanvasSignature,
  tapSegment,
} from './app.js';

test.describe('game loop', () => {
  test('a tap on a blocked segment bounces and costs a life', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    const blocked = firstBlockedSegment(board);

    await openBoard(page, FIXTURE_BOARD);
    const livesBefore = await readLives(page);

    await tapSegment(page, board, blocked);

    await expect.poll(() => readLives(page)).toBe(livesBefore - 1);
    expect((await readCounter(page)).removed).toBe(0);
  });

  test('a bounced segment stays marked on the board it bounced off', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    const blocked = firstBlockedSegment(board);

    await openBoard(page, FIXTURE_BOARD);
    const untouched = await canvasSignature(page);

    await tapSegment(page, board, blocked);

    await expect
      .poll(async () => (await readSavedGame(page))?.value.bouncedSegments)
      .toEqual([blocked]);
    // Nothing has left the board, so the only thing the base layer can have
    // repainted once the bounce lands is the segment that bounced.
    expect(await settledCanvasSignature(page)).not.toBe(untouched);
    expect((await readCounter(page)).removed).toBe(0);
  });

  test('zero lives replays the same board', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    const free = firstFreeSegment(board);
    const blocked = firstBlockedSegment(board, [free]);

    await openBoard(page, FIXTURE_BOARD);
    const fullBoard = await canvasSignature(page);
    const lives = await readLives(page);

    // Remove something first, so a board that came back only because nothing
    // ever changed cannot pass this.
    await tapSegment(page, board, free);
    await expect.poll(async () => (await readCounter(page)).removed).toBe(1);
    expect(await canvasSignature(page)).not.toBe(fullBoard);

    for (let i = 0; i < lives; i++) {
      await tapSegment(page, board, blocked);
      await expect.poll(() => readLives(page)).toBe(lives - 1 - i);
    }

    await expect(page.locator('.hud-foot')).toContainText('Out of lives');

    await expect.poll(() => readLives(page)).toBe(lives);
    await expect.poll(async () => (await readCounter(page)).removed).toBe(0);
    await expect.poll(() => canvasSignature(page)).toBe(fullBoard);
  });

  test('clearing every segment wins', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    const order = clearingOrder(board);

    await openBoard(page, FIXTURE_BOARD);
    const lives = await readLives(page);

    for (const [index, id] of order.entries()) {
      await tapSegment(page, board, id);
      await expect.poll(async () => (await readCounter(page)).removed).toBe(index + 1);
    }

    const { removed, total } = await readCounter(page);
    expect(removed).toBe(total);
    await expect(page.locator('.hud-foot')).toContainText('Board cleared');
    // Every tap in a clearing order is on a free segment, so a life lost here
    // means the tap landed on something other than what it aimed at.
    expect(await readLives(page)).toBe(lives);
  });
});
