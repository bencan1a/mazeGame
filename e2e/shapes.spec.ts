import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BASE_PATH } from '../playwright.config.js';
import { generateBoard } from '../src/core/generate.js';
import { genParamsForShape, shapeGenerateOptions } from '../src/game/shapeBoard.js';
import {
  SHAPE_ASSET_FILE,
  SHAPE_MANIFEST_FILE,
  SHAPE_OUTLINE_FILE,
  decodeShapeLibrary,
  packedBytesPerShape,
} from '../src/game/shapeLibrary.js';
import { isCanvasPainted, readCounter } from './app.js';

/** The library as it was baked, read from the files the build copies into the site. */
function bakedLibrary(): ReturnType<typeof decodeShapeLibrary> {
  const asset = readFileSync(`public/${SHAPE_ASSET_FILE}`);
  return decodeShapeLibrary(
    readFileSync(`public/${SHAPE_MANIFEST_FILE}`, 'utf8'),
    asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength),
    readFileSync(`public/${SHAPE_OUTLINE_FILE}`, 'utf8'),
  );
}

const library = bakedLibrary();

function shapeAt(index: number): { id: string; name: string } {
  const shape = library.shapes[index];
  if (shape === undefined) throw new Error(`the baked library has no shape ${index}`);
  return shape;
}

const first = shapeAt(0);
const last = shapeAt(library.shapes.length - 1);

/** Segments the first shape's board has, generated here from the same drawing the app loads. */
function expectedSegmentCount(id: string): number {
  const params = genParamsForShape(id);
  const ink = library.ink(id);
  if (ink === null) throw new Error(`no drawing for ${id}`);
  const options = shapeGenerateOptions({ ink, edge: library.edge }, params.gridSize);
  return generateBoard(params, options).segmentCount;
}

async function openHome(page: Page): Promise<void> {
  await page.goto(BASE_PATH);
  await expect(page.locator('.home-title')).toHaveText(first.name);
}

/** True once the home screen's drawing canvas holds more than one colour. */
async function isDrawingPainted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.home-drawing');
    if (canvas === null || canvas.width === 0) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 4; i < data.length; i += 4) {
      if (data[i + 3] !== data[3]) return true;
    }
    return false;
  });
}

test.describe('the baked shape library', () => {
  test('is served under the base path, whole', async ({ page }) => {
    const manifest = await page.request.get(`${BASE_PATH}${SHAPE_MANIFEST_FILE}`);
    expect(manifest.status()).toBe(200);
    const named = (await manifest.json()) as { shapes: unknown[] };
    expect(named.shapes.length).toBe(library.shapes.length);

    const asset = await page.request.get(`${BASE_PATH}${SHAPE_ASSET_FILE}`);
    expect(asset.status()).toBe(200);
    expect((await asset.body()).length).toBe(
      12 + library.shapes.length * packedBytesPerShape(library.edge),
    );
  });

  test('browses from the first shape to the last, drawing each one', async ({ page }) => {
    await openHome(page);
    await expect.poll(() => isDrawingPainted(page)).toBe(true);

    // Backwards from the first shape wraps to the last, which is only the last
    // if every shape in between is in the library the app loaded.
    await page.getByLabel('Previous shape').click();
    await expect(page.locator('.home-title')).toHaveText(last.name);
    await expect.poll(() => isDrawingPainted(page)).toBe(true);

    await page.getByLabel('Next shape').click();
    await expect(page.locator('.home-title')).toHaveText(first.name);
  });

  test('plays a board cut from the shape on screen, not a procedural one', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Play' }).click();

    await expect(page.locator('.board-canvas').first()).toBeVisible();
    await expect
      .poll(async () => (await readCounter(page)).total)
      .toBe(expectedSegmentCount(first.id));
    await expect.poll(() => isCanvasPainted(page)).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('the baked shape library offline', () => {
  test.describe.configure({ mode: 'serial' });

  test('a second load still browses the library and plays a shape', async ({ page, context }) => {
    await openHome(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    await context.setOffline(true);
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
    await expect(page.locator('.home-title')).toHaveText(first.name);
    await expect.poll(() => isDrawingPainted(page)).toBe(true);

    await page.getByRole('button', { name: 'Play' }).click();
    await expect
      .poll(async () => (await readCounter(page)).total)
      .toBe(expectedSegmentCount(first.id));
    expect(errors).toEqual([]);

    await context.setOffline(false);
  });
});
