import { expect, test } from '@playwright/test';
import { baseCanvas, isCanvasPainted, openBoard, readCounter, readLives } from './app.js';

test.describe('smoke', () => {
  test('mounts, generates a board, and paints a non-blank frame', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBoard(page);

    const canvas = baseCanvas(page);
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);

    expect(await isCanvasPainted(page)).toBe(true);

    const { removed, total } = await readCounter(page);
    expect(removed).toBe(0);
    expect(total).toBeGreaterThan(0);
    expect(await readLives(page)).toBeGreaterThan(0);

    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
