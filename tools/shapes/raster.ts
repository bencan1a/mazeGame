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
  /**
   * Ink for flat colour art: the drawing is in the boundaries between colour
   * areas, not in a stroke layer, so a cell inks where its colour differs from
   * a neighbour's or where nothing was painted at all.
   */
  boundaryInk(svg: string, size: number, quantiseBits?: number): Promise<Uint8Array>;
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
    async boundaryInk(svg: string, size: number, quantiseBits = 4): Promise<Uint8Array> {
      const flags = await page.evaluate(
        async ([markup, edge, bits]: [string, number, number]) => {
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
          // Quantised, so a gradient inside one flat-looking area does not read
          // as a boundary every few pixels. Everything here is inline: tsx
          // renames the functions it compiles, and the rename does not survive
          // being serialised into the page.
          const keys: number[] = new Array<number>(edge * edge);
          for (let i = 0; i < edge * edge; i++) {
            keys[i] =
              (pixels[i * 4 + 3] as number) < 128
                ? -1
                : (((pixels[i * 4] as number) >> bits) << 16) |
                  (((pixels[i * 4 + 1] as number) >> bits) << 8) |
                  ((pixels[i * 4 + 2] as number) >> bits);
          }
          const out: number[] = new Array<number>(edge * edge);
          for (let y = 0; y < edge; y++) {
            for (let x = 0; x < edge; x++) {
              const i = y * edge + x;
              const here = keys[i] as number;
              if (here === -1) {
                out[i] = 1;
                continue;
              }
              const right = x + 1 < edge ? (keys[i + 1] as number) : here;
              const down = y + 1 < edge ? (keys[i + edge] as number) : here;
              out[i] = here !== right || here !== down ? 1 : 0;
            }
          }
          return out;
        },
        [svg, size, quantiseBits] as [string, number, number],
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

/** Strips the intrinsic size so the viewBox alone decides how the art scales. */
export function withoutIntrinsicSize(svg: string): string {
  return svg.replace(/\s(width|height)="[^"]*"/g, ' ');
}

/** A solid glyph: every path filled, nothing stroked. */
export function asSolid(svg: string): string {
  return svg
    .replace(/fill="none"/, 'fill="#000"')
    .replace(/stroke="currentColor"/, 'stroke="none"');
}
