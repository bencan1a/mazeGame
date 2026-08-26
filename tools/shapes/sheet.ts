/** Contact sheet: every board as coloured cells, for the eye rather than the CSV. */

import { chromium } from '@playwright/test';

export interface Tile {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** Colour index per cell, -1 for empty. */
  readonly cells: number[];
}

const PALETTE = [
  '#f4b400',
  '#3ea6ff',
  '#8bd0ff',
  '#12b886',
  '#ff7043',
  '#b388ff',
  '#f06292',
  '#9ccc65',
];

export async function writeSheet(tiles: readonly Tile[], file: string, columns = 6): Promise<void> {
  if (tiles.length === 0) return;
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
  const page = await browser.newPage({ viewport: { width: 1240, height: 800 } });
  await page.setContent(sheetHtml(tiles, columns));
  await page.locator('#sheet').screenshot({ path: file });
  await browser.close();
}

function sheetHtml(tiles: readonly Tile[], columns: number): string {
  const cells = tiles
    .map(
      (tile) =>
        `<figure><canvas width="${tile.width}" height="${tile.height}" data-cells='${JSON.stringify(tile.cells)}'></canvas><figcaption>${tile.label}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12101f;font:11px system-ui,sans-serif;color:#c9c6d8}
    #sheet{display:grid;grid-template-columns:repeat(${columns},1fr);gap:10px;padding:12px;width:1216px}
    figure{margin:0;text-align:center}
    canvas{width:100%;image-rendering:pixelated;background:#171429;border-radius:4px}
    figcaption{padding-top:3px}
  </style><div id="sheet">${cells}</div><script>
    const palette = ${JSON.stringify(PALETTE)};
    for (const canvas of document.querySelectorAll('canvas')) {
      const cells = JSON.parse(canvas.dataset.cells);
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < cells.length; i++) {
        const colour = cells[i] < 0 ? null : palette[cells[i] % palette.length];
        const rgb = colour === null ? [23, 20, 41] : [parseInt(colour.slice(1,3),16), parseInt(colour.slice(3,5),16), parseInt(colour.slice(5,7),16)];
        image.data[i*4] = rgb[0]; image.data[i*4+1] = rgb[1]; image.data[i*4+2] = rgb[2]; image.data[i*4+3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }
  </script>`;
}
