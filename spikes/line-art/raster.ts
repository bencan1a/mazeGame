/**
 * Build-time rasteriser. `src/core` may not touch a canvas, so shapes have to
 * arrive already rasterised; this is the offline half of that, using the
 * Chromium the browser suite already installs.
 */

import { chromium, type Browser, type Page } from '@playwright/test';

const SYSTEM_CHROMIUM = '/opt/pw-browsers/chromium';

export interface Rasteriser {
  /** 1 = ink, at `size` x `size`. */
  ink(svg: string, size: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export async function openRasteriser(): Promise<Rasteriser> {
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ executablePath: SYSTEM_CHROMIUM });
  }
  const page: Page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');

  return {
    async ink(svg: string, size: number): Promise<Uint8Array> {
      const flags = await page.evaluate(
        async ([markup, edge]: [string, number]) => {
          const canvas = document.createElement('canvas');
          canvas.width = edge;
          canvas.height = edge;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('no 2d context');
          const image = new Image();
          image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
          await image.decode();
          context.drawImage(image, 0, 0, edge, edge);
          const pixels = context.getImageData(0, 0, edge, edge).data;
          const out: number[] = new Array<number>(edge * edge);
          for (let i = 0; i < edge * edge; i++)
            out[i] = (pixels[i * 4 + 3] as number) > 128 ? 1 : 0;
          return out;
        },
        [svg, size] as [string, number],
      );
      return Uint8Array.from(flags);
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

/**
 * Stroke width is set in board cells rather than user units, since it is the
 * gap width the player sees. The viewBox is read from the source.
 */
export function withStrokeWidth(svg: string, cells: number, size: number): string {
  const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg);
  const units = viewBox === null ? 24 : Number(viewBox[1]);
  const width = (cells * units) / size;
  return svg
    .replace(/stroke-width="[^"]*"/, `stroke-width="${width.toFixed(3)}"`)
    .replace(/stroke="currentColor"/, 'stroke="#000"');
}

/** A solid glyph: every path filled, nothing stroked. */
export function asSolid(svg: string): string {
  return svg
    .replace(/fill="none"/, 'fill="#000"')
    .replace(/stroke="currentColor"/, 'stroke="none"');
}
