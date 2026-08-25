import { expect, test } from '@playwright/test';
import { isCanvasPainted, openBoard, readCounter } from './app.js';

test.describe('offline', () => {
  // Each test installs its own worker, and a shared context would let one
  // test's cache satisfy another's first load.
  test.describe.configure({ mode: 'serial' });

  test('a second load plays with the network cut', async ({ page, context }) => {
    await openBoard(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    await context.setOffline(true);

    // Proof the cut is real: anything the worker has not cached must now fail.
    const reachable = await page.evaluate(async () => {
      try {
        await fetch(`./not-precached-${Date.now()}.json`, { cache: 'no-store' });
        return true;
      } catch {
        return false;
      }
    });
    expect(reachable, 'the network was still reachable, so this proves nothing').toBe(false);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.reload();
    await expect(page.locator('.board-canvas').first()).toBeVisible();
    await expect.poll(async () => (await readCounter(page)).total).toBeGreaterThan(0);
    await expect.poll(() => isCanvasPainted(page)).toBe(true);
    expect(errors).toEqual([]);

    await context.setOffline(false);
  });
});
