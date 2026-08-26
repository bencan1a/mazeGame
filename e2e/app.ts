import { expect, type Locator, type Page } from '@playwright/test';
import { BASE_PATH } from '../playwright.config.js';
import { generateBoard } from '../src/core/generate.js';
import { DEFAULT_GEN_PARAMS, type Board, type GenParams } from '../src/core/types.js';
import {
  cell,
  cellCenterToCssPixel,
  clampPan,
  createViewport,
  type Viewport,
} from '../src/render/viewport.js';

export interface BoardQuery {
  readonly seed: number;
  readonly grid: number;
}

/** A small board: every segment is reachable in a few taps, and it fits the runner's viewport. */
export const FIXTURE_BOARD: BoardQuery = { seed: 12345, grid: 16 };

export function boardUrl(query: BoardQuery): string {
  return `${BASE_PATH}?seed=${query.seed}&grid=${query.grid}`;
}

export function genParams(query: BoardQuery): GenParams {
  return { ...DEFAULT_GEN_PARAMS, seed: query.seed, gridSize: query.grid };
}

/** The same board the page will generate, built here so a test can name a segment. */
export function fixtureBoard(query: BoardQuery): Board {
  return generateBoard(genParams(query));
}

export function liveStat(page: Page): Locator {
  return page.getByLabel(/lives remaining/);
}

/** Found by content, so reordering the chrome does not silently break every test. */
export function counterStat(page: Page): Locator {
  return page.locator('.hud-stat').filter({ hasText: /\d+\/\d+/ });
}

export function baseCanvas(page: Page): Locator {
  return page.locator('.board-canvas').first();
}

/** `removed`, `total` as the chrome reports them. */
export async function readCounter(page: Page): Promise<{ removed: number; total: number }> {
  const text = (await counterStat(page).textContent()) ?? '';
  const match = /(\d+)\/(\d+)/.exec(text);
  if (match === null) throw new Error(`counter unreadable: ${JSON.stringify(text)}`);
  return { removed: Number(match[1]), total: Number(match[2]) };
}

export async function readLives(page: Page): Promise<number> {
  const label = (await liveStat(page).getAttribute('aria-label')) ?? '';
  const match = /^(\d+) lives remaining$/.exec(label);
  if (match === null) throw new Error(`lives unreadable: ${JSON.stringify(label)}`);
  return Number(match[1]);
}

/**
 * True once the base canvas holds more than one distinct colour. The board is
 * painted a frame or two after the canvas is in the DOM, and an unallocated
 * drawing buffer reads back as a uniform blank rather than throwing.
 */
export async function isCanvasPainted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.board-canvas');
    if (canvas === null || canvas.width === 0 || canvas.height === 0) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 4; i < data.length; i += 4) {
      if (
        data[i] !== data[0] ||
        data[i + 1] !== data[1] ||
        data[i + 2] !== data[2] ||
        data[i + 3] !== data[3]
      ) {
        return true;
      }
    }
    return false;
  });
}

/** Loads a board and waits until it is generated, laid out, and painted. */
export async function openBoard(page: Page, query: BoardQuery = FIXTURE_BOARD): Promise<void> {
  await page.goto(boardUrl(query));
  await expect(baseCanvas(page)).toBeVisible();
  await expect
    .poll(async () => (await readCounter(page)).total, { message: 'board never generated' })
    .toBeGreaterThan(0);
  await expect.poll(() => isCanvasPainted(page), { message: 'board never painted' }).toBe(true);
}

/**
 * The viewport the controller settles on for a freshly opened board: fitted to
 * the surface, then centred by the pan clamp. Reproduced here rather than read
 * out of the page, so a test names a cell and this says where it is on screen.
 */
export async function restingViewport(page: Page, board: Board): Promise<Viewport<'css'>> {
  const box = await page.locator('.board-surface').boundingBox();
  if (box === null) throw new Error('board surface has no layout box');
  const scale = Math.min(box.width / board.width, box.height / board.height) || 1;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  return clampPan(createViewport({ scale, dpr }), {
    boardWidth: board.width,
    boardHeight: board.height,
    canvasCssWidth: box.width,
    canvasCssHeight: box.height,
  });
}

/** Page coordinates of a board cell's centre, ready for `page.mouse`. */
export async function cellCenterOnScreen(
  page: Page,
  board: Board,
  cellX: number,
  cellY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('.board-surface').boundingBox();
  if (box === null) throw new Error('board surface has no layout box');
  const viewport = await restingViewport(page, board);
  const point = cellCenterToCssPixel(viewport, cell(cellX, cellY));
  return { x: box.x + point.x, y: box.y + point.y };
}

/** Cell coordinates of every cell in `id`, tail -> head. */
export function segmentCells(board: Board, id: number): { x: number; y: number }[] {
  const start = board.segStart[id - 1] as number;
  const end = board.segStart[id] as number;
  const cells: { x: number; y: number }[] = [];
  for (let k = start; k < end; k++) {
    const index = board.segCells[k] as number;
    cells.push({ x: index % board.width, y: Math.floor(index / board.width) });
  }
  return cells;
}

function outDegree(board: Board, id: number): number {
  return (board.edgeStart[id] as number) - (board.edgeStart[id - 1] as number);
}

/** A segment with nothing on its ray, so tapping it removes it. */
export function firstFreeSegment(board: Board): number {
  for (let id = 1; id <= board.segmentCount; id++) {
    if (outDegree(board, id) === 0) return id;
  }
  throw new Error('no free segment on a board that must have one');
}

/**
 * A segment something else sits in front of, so tapping it bounces — and still
 * does once every segment in `alreadyRemoved` has gone.
 */
export function firstBlockedSegment(board: Board, alreadyRemoved: readonly number[] = []): number {
  const gone = new Set(alreadyRemoved);
  for (let id = 1; id <= board.segmentCount; id++) {
    if (gone.has(id)) continue;
    const start = board.edgeStart[id - 1] as number;
    const end = board.edgeStart[id] as number;
    for (let k = start; k < end; k++) {
      if (!gone.has(board.edgeTarget[k] as number)) return id;
    }
  }
  throw new Error('board has no segment that stays blocked');
}

/**
 * One order in which every segment can be tapped away. The blocking digraph is
 * acyclic, so peeling off whatever is free repeatedly always reaches the end;
 * a board that stalls here is unsolvable and the caller should say so.
 */
export function clearingOrder(board: Board): number[] {
  const removed = new Uint8Array(board.segmentCount + 1);
  const order: number[] = [];
  while (order.length < board.segmentCount) {
    let progressed = false;
    for (let id = 1; id <= board.segmentCount; id++) {
      if (removed[id] === 1) continue;
      const start = board.edgeStart[id - 1] as number;
      const end = board.edgeStart[id] as number;
      let free = true;
      for (let k = start; k < end && free; k++) {
        free = removed[board.edgeTarget[k] as number] === 1;
      }
      if (!free) continue;
      removed[id] = 1;
      order.push(id);
      progressed = true;
    }
    if (!progressed) throw new Error('blocking digraph has a cycle; board is unsolvable');
  }
  return order;
}

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Base-layer pixels at the centre of each named cell. The static layer is
 * cleared to transparent and only drawn where a segment still sits, so alpha
 * alone says whether a cell is occupied — no palette colour has to be named.
 */
export async function readCellPixels(
  page: Page,
  board: Board,
  cells: readonly { x: number; y: number }[],
): Promise<Rgba[]> {
  const viewport = await restingViewport(page, board);
  const points = cells.map((c) => {
    const point = cellCenterToCssPixel(viewport, cell(c.x, c.y));
    return { x: point.x, y: point.y };
  });
  return page.evaluate((cssPoints) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.board-canvas');
    if (canvas === null) throw new Error('no board canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no 2d context');
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    return cssPoints.map((p) => {
      const { data } = ctx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1);
      return {
        r: data[0] as number,
        g: data[1] as number,
        b: data[2] as number,
        a: data[3] as number,
      };
    });
  }, points);
}

/** Taps the centre of a board cell with a real pointer event. */
export async function tapCell(
  page: Page,
  board: Board,
  cellX: number,
  cellY: number,
): Promise<void> {
  const point = await cellCenterOnScreen(page, board, cellX, cellY);
  await page.mouse.click(point.x, point.y);
}

/**
 * A checksum of the whole base layer. Two boards generated from the same seed
 * paint identically, so this is what "the same board came back" looks like
 * without committing a screenshot.
 */
export async function canvasSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.board-canvas');
    if (canvas === null) throw new Error('no board canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no 2d context');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i] as number;
      hash = Math.imul(hash, 0x01000193);
    }
    return `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`;
  });
}

/** Consecutive agreeing reads that count as "the board has stopped moving". */
const SETTLED_READS = 3;

/**
 * `canvasSignature`, taken once the base layer has stopped changing. An exit
 * reaches the base layer's final content as it starts — the segment is gone
 * from the buffer already — but a bounce puts its segment back when it lands,
 * so a single read can catch a board mid-flight.
 */
export async function settledCanvasSignature(page: Page): Promise<string> {
  let signature = await canvasSignature(page);
  let agreed = 0;
  await expect
    .poll(async () => {
      const next = await canvasSignature(page);
      agreed = next === signature ? agreed + 1 : 0;
      signature = next;
      return agreed;
    })
    .toBeGreaterThanOrEqual(SETTLED_READS);
  return signature;
}

/** Taps the middle cell of `id`. */
export async function tapSegment(page: Page, board: Board, id: number): Promise<void> {
  const cells = segmentCells(board, id);
  const aimed = cells[Math.floor(cells.length / 2)];
  if (aimed === undefined) throw new Error(`segment ${id} has no cells`);
  await tapCell(page, board, aimed.x, aimed.y);
}

export interface SavedRecord {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

/**
 * The app's saved game, found by scanning storage rather than by naming the
 * key: the key is the app's own and there is only ever one.
 */
export async function readSavedGame(page: Page): Promise<SavedRecord | null> {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('arrow-maze'));
    if (keys.length === 0) return null;
    if (keys.length > 1) throw new Error(`expected one saved game, found ${keys.join(', ')}`);
    const key = keys[0] as string;
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return { key, value: JSON.parse(raw) as Record<string, unknown> };
  });
}
