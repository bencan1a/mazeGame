import { expect, test } from '@playwright/test';
import {
  FIXTURE_BOARD,
  firstFreeSegment,
  fixtureBoard,
  openBoard,
  readCounter,
  tapSegment,
} from './app.js';

/**
 * A deterministic seed paints a deterministic board, so a screenshot is a
 * regression net over the whole render path — palette, arrowheads, fit and
 * blit at once. The tolerance is deliberately loose: a runner image change
 * moves antialiasing by a pixel or two and that is not a regression.
 *
 * Only the board surface is captured. The chrome around it is text in a system
 * font, which differs between a runner and a workstation for reasons that have
 * nothing to do with this repo.
 */
const TOLERANCE = { maxDiffPixelRatio: 0.02, threshold: 0.25 } as const;

test.describe('visual regression', () => {
  test('the fixture board renders as it did', async ({ page }) => {
    await openBoard(page, FIXTURE_BOARD);
    await expect(page.locator('.board-surface')).toHaveScreenshot('fixture-board.png', TOLERANCE);
  });

  test('a cleared segment leaves the rest of the board untouched', async ({ page }) => {
    const board = fixtureBoard(FIXTURE_BOARD);
    await openBoard(page, FIXTURE_BOARD);

    await tapSegment(page, board, firstFreeSegment(board));
    await expect.poll(async () => (await readCounter(page)).removed).toBe(1);

    await expect(page.locator('.board-surface')).toHaveScreenshot(
      'fixture-board-one-removed.png',
      TOLERANCE,
    );
  });
});
