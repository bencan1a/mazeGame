/**
 * The board cell <-> pixel transform, shared by the static buffer, the
 * animation layer, pan/zoom, and hit testing. Every other module in
 * `src/render` composes this rather than deriving its own arithmetic.
 *
 * Three coordinate spaces exist and are not interchangeable:
 *   - `Cell`, a board cell.
 *   - `CssPixel`, CSS pixels: the units a pointer event or a canvas laid out
 *     with CSS reports. `dpr` converts between this and `DevicePixel`.
 *   - `DevicePixel`, device pixels: the units a canvas backing store is
 *     sized in.
 *   - `'buffer'`-space `Viewport`s describe a *third* space, the static
 *     offscreen buffer's own backing-store pixels — sized independently of
 *     screen dpr and zoom, and never a `CssPixel`/`DevicePixel` value.
 * `Viewport<S>` is generic over which of `'css'`/`'buffer'` it maps a cell
 * into, so a buffer-space viewport cannot type-check where a screen-facing
 * one (pan/zoom, hit testing) is expected. `Cell`/`CssPixel`/`DevicePixel`
 * are nominal for the same reason: same shape, different meaning, and a
 * plain `{x, y}` literal will not satisfy any of them — build one with
 * `cell()`/`cssPixel()`/`devicePixel()`.
 */

declare const cellBrand: unique symbol;
export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly [cellBrand]: true;
}

export function cell(x: number, y: number): Cell {
  return { x, y } as Cell;
}

declare const cssPixelBrand: unique symbol;
export interface CssPixel {
  readonly x: number;
  readonly y: number;
  readonly [cssPixelBrand]: true;
}

export function cssPixel(x: number, y: number): CssPixel {
  return { x, y } as CssPixel;
}

declare const devicePixelBrand: unique symbol;
export interface DevicePixel {
  readonly x: number;
  readonly y: number;
  readonly [devicePixelBrand]: true;
}

export function devicePixel(x: number, y: number): DevicePixel {
  return { x, y } as DevicePixel;
}

/**
 * The canvas surface both render layers are built on, and the shape
 * `blitStaticLayer` accepts as its blit source: a real `HTMLCanvasElement`
 * satisfies this directly, and so does a hand-written test fake, without
 * needing the full DOM `CanvasImageSource` surface either one would
 * otherwise be checked against.
 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

/** `'css'`: the screen viewport pan/zoom and hit testing use. `'buffer'`: a static offscreen buffer's own pixels. */
export type PixelSpace = 'css' | 'buffer';

export interface Viewport<S extends PixelSpace = 'css'> {
  /** Which pixel space this viewport maps a cell into. */
  readonly space: S;
  /** `S`-space pixels per board cell. */
  readonly scale: number;
  /** Device pixels per CSS pixel. Only meaningful — and only usable — when `space` is `'css'`. */
  readonly dpr: number;
  /** `S`-space position of board cell (0, 0)'s top-left corner. */
  readonly originX: number;
  readonly originY: number;
}

export interface ViewportInit {
  readonly scale: number;
  readonly dpr?: number;
  readonly originX?: number;
  readonly originY?: number;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

function requirePositiveFinite(value: number, name: string): void {
  requireFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive, got ${value}`);
  }
}

/** As `requirePositiveFinite`, but zero is a legitimate size — a canvas mid-layout, not caller error. */
function requireNonNegativeFinite(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}

/**
 * A caller across the render boundary hands this whatever the platform gave
 * it — `devicePixelRatio`, a layout measurement — so a non-finite or
 * non-positive `scale`/`dpr` is rejected here rather than turning every
 * pixel <-> cell conversion downstream into `NaN` or `Infinity`.
 */
export function createViewport(init: ViewportInit): Viewport<'css'> {
  const scale = init.scale;
  const dpr = init.dpr ?? 1;
  const originX = init.originX ?? 0;
  const originY = init.originY ?? 0;
  requirePositiveFinite(scale, 'scale');
  requirePositiveFinite(dpr, 'dpr');
  requireFinite(originX, 'originX');
  requireFinite(originY, 'originY');
  return { space: 'css', scale, dpr, originX, originY };
}

/**
 * A static offscreen buffer's own cell -> pixel mapping. `scale` is buffer
 * pixels per cell, unrelated to CSS pixels, zoom, or screen `dpr` — building
 * this through `createViewport` instead is exactly the unit mixup this type
 * exists to make impossible.
 */
export function createBufferViewport(scale: number, originX = 0, originY = 0): Viewport<'buffer'> {
  requirePositiveFinite(scale, 'scale');
  requireFinite(originX, 'originX');
  requireFinite(originY, 'originY');
  return { space: 'buffer', scale, dpr: 1, originX, originY };
}

/**
 * X component of a cell's center, in `viewport`'s own pixel space, without
 * allocating a point object — for hot loops that would otherwise allocate
 * one per cell.
 */
export function cellCenterX<S extends PixelSpace>(viewport: Viewport<S>, cellX: number): number {
  return viewport.originX + cellX * viewport.scale + viewport.scale / 2;
}

/** Y component of a cell's center, in `viewport`'s own pixel space. See `cellCenterX`. */
export function cellCenterY<S extends PixelSpace>(viewport: Viewport<S>, cellY: number): number {
  return viewport.originY + cellY * viewport.scale + viewport.scale / 2;
}

/** Top-left corner of `c`, in CSS pixels. */
export function cellToCssPixel(viewport: Viewport<'css'>, c: Cell): CssPixel {
  return cssPixel(viewport.originX + c.x * viewport.scale, viewport.originY + c.y * viewport.scale);
}

/** Center of `c`, in CSS pixels. */
export function cellCenterToCssPixel(viewport: Viewport<'css'>, c: Cell): CssPixel {
  return cssPixel(cellCenterX(viewport, c.x), cellCenterY(viewport, c.y));
}

/** The cell containing a CSS-pixel point. Not bounds-checked against the board. */
export function cssPixelToCell(viewport: Viewport<'css'>, point: CssPixel): Cell {
  return cell(
    Math.floor((point.x - viewport.originX) / viewport.scale),
    Math.floor((point.y - viewport.originY) / viewport.scale),
  );
}

export function cssPixelToDevicePixel(viewport: Viewport<'css'>, point: CssPixel): DevicePixel {
  return devicePixel(point.x * viewport.dpr, point.y * viewport.dpr);
}

export function devicePixelToCssPixel(viewport: Viewport<'css'>, point: DevicePixel): CssPixel {
  return cssPixel(point.x / viewport.dpr, point.y / viewport.dpr);
}

/** Top-left corner of `c`, in device pixels. */
export function cellToDevicePixel(viewport: Viewport<'css'>, c: Cell): DevicePixel {
  return cssPixelToDevicePixel(viewport, cellToCssPixel(viewport, c));
}

/** The cell containing a device-pixel point. Not bounds-checked against the board. */
export function devicePixelToCell(viewport: Viewport<'css'>, point: DevicePixel): Cell {
  return cssPixelToCell(viewport, devicePixelToCssPixel(viewport, point));
}

/** Device pixels per board cell — `scale * dpr`. Only defined for a `'css'` viewport; a buffer has no dpr. */
export function cellSizeInDevicePixels(viewport: Viewport<'css'>): number {
  return viewport.scale * viewport.dpr;
}

/**
 * Pan and zoom as pure transforms over a `'css'`-space `Viewport`, plus the
 * clamping rules that keep both within bounds, and the blit that turns the
 * result into pixels. Nothing here touches a board or a segment: panning and
 * zooming only ever move the rectangle the static buffer is sampled through.
 */

/** Translates `viewport`'s origin by a CSS-pixel delta. Unbounded — pair with `clampPan`. */
export function panViewport(viewport: Viewport<'css'>, dx: number, dy: number): Viewport<'css'> {
  requireFinite(dx, 'dx');
  requireFinite(dy, 'dy');
  return { ...viewport, originX: viewport.originX + dx, originY: viewport.originY + dy };
}

/**
 * Rescales `viewport` to `nextScale`, adjusting the origin so the board point
 * currently under CSS pixel `(focalX, focalY)` stays under it. `nextScale` is
 * assumed already clamped by the caller — see `clampZoomScale`.
 */
export function zoomViewportAt(
  viewport: Viewport<'css'>,
  nextScale: number,
  focalX: number,
  focalY: number,
): Viewport<'css'> {
  requirePositiveFinite(nextScale, 'nextScale');
  requireFinite(focalX, 'focalX');
  requireFinite(focalY, 'focalY');
  const ratio = nextScale / viewport.scale;
  const originX = focalX - (focalX - viewport.originX) * ratio;
  const originY = focalY - (focalY - viewport.originY) * ratio;
  return { ...viewport, scale: nextScale, originX, originY };
}

/**
 * CSS px/cell past which a magnified blit of the static buffer reads as soft
 * rather than sharp on a typical phone screen. A `drawImage` blit costs the
 * same single call at any scale, so this is a legibility choice, not a
 * memory one — the buffer's own resolution cap is enforced once, at
 * allocation, by `layers.ts`. 120 is 4x the buffer's own resting resolution
 * (`BASE_CSS_PIXELS_PER_CELL` in `layers.ts`, 10 CSS px/cell at 1x zoom): a
 * 4x nearest/bilinear upscale is still comfortably readable, and it leaves a
 * dense board plenty of room to zoom in on one contested segment.
 */
export const DEFAULT_MAX_LEGIBLE_CSS_PIXELS_PER_CELL = 120;

/**
 * The zoom ceiling for `clampZoomScale`: `legibilityLimit`, or `minScale`
 * itself when that already exceeds it — a small board's fit-to-canvas
 * minimum is always within the reachable range, whatever it is.
 */
export function maxZoomScale(
  minScale: number,
  legibilityLimit: number = DEFAULT_MAX_LEGIBLE_CSS_PIXELS_PER_CELL,
): number {
  requireNonNegativeFinite(minScale, 'minScale');
  requirePositiveFinite(legibilityLimit, 'legibilityLimit');
  return Math.max(minScale, legibilityLimit);
}

/**
 * Clamps a requested scale between `minScale` and `maxScale` (see
 * `maxZoomScale`). `minScale` accepts zero: a fit-to-canvas minimum computed
 * against a canvas that hasn't been measured yet is legitimately zero, not
 * caller error. If `maxScale` is ever built some other way and ends up below
 * `minScale`, the result is `maxScale`.
 */
export function clampZoomScale(scale: number, minScale: number, maxScale: number): number {
  requirePositiveFinite(scale, 'scale');
  requireNonNegativeFinite(minScale, 'minScale');
  requirePositiveFinite(maxScale, 'maxScale');
  if (minScale > maxScale) return maxScale;
  return Math.min(Math.max(scale, minScale), maxScale);
}

export interface PanBounds {
  readonly boardWidth: number;
  readonly boardHeight: number;
  /** The visible canvas, in CSS pixels — not the buffer, and not device pixels. */
  readonly canvasCssWidth: number;
  readonly canvasCssHeight: number;
}

/**
 * One axis of `clampPan`: content smaller than the viewport is centered and
 * fixed there, not draggable at all. Content larger than the viewport has its
 * origin clamped to the range `[viewportSize - contentSize, 0]` — the range
 * over which the content spans the viewport completely, with no empty margin
 * on either side.
 */
function clampPanAxis(origin: number, contentSize: number, viewportSize: number): number {
  if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
  return Math.min(0, Math.max(viewportSize - contentSize, origin));
}

/**
 * Clamps `viewport`'s origin so the board can never be panned entirely off
 * screen: centered and fixed when it fits inside the canvas, otherwise
 * clamped to always cover the canvas fully. See `clampPanAxis`.
 *
 * `canvasCssWidth`/`canvasCssHeight` accept zero: a canvas mid-layout with no
 * measured size yet is routine, not caller error, and the clamp is still
 * well-defined there.
 */
export function clampPan(viewport: Viewport<'css'>, bounds: PanBounds): Viewport<'css'> {
  requirePositiveFinite(bounds.boardWidth, 'boardWidth');
  requirePositiveFinite(bounds.boardHeight, 'boardHeight');
  requireNonNegativeFinite(bounds.canvasCssWidth, 'canvasCssWidth');
  requireNonNegativeFinite(bounds.canvasCssHeight, 'canvasCssHeight');
  const originX = clampPanAxis(
    viewport.originX,
    bounds.boardWidth * viewport.scale,
    bounds.canvasCssWidth,
  );
  const originY = clampPanAxis(
    viewport.originY,
    bounds.boardHeight * viewport.scale,
    bounds.canvasCssHeight,
  );
  return { ...viewport, originX, originY };
}

export interface BlitRects {
  /** Buffer pixels. */
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Device pixels, on the visible (unscaled) canvas. */
  readonly destX: number;
  readonly destY: number;
  readonly destWidth: number;
  readonly destHeight: number;
}

/**
 * The source/dest rects for one `drawImage` blit of the static buffer,
 * clipped to the part of the buffer the CSS-space `viewport` currently
 * shows. `null` when nothing overlaps — a zero-size `canvasCssWidth`/
 * `canvasCssHeight` included — and `blitStaticLayer` treats that as "draw
 * nothing this frame" rather than passing a degenerate rect to `drawImage`.
 *
 * `bufferPixelsPerCell` is the static buffer's own scale (`Viewport<'buffer'>.scale`).
 */
export function computeBlitRects(
  viewport: Viewport<'css'>,
  bufferPixelsPerCell: number,
  bufferWidthPx: number,
  bufferHeightPx: number,
  canvasCssWidth: number,
  canvasCssHeight: number,
): BlitRects | null {
  requirePositiveFinite(bufferPixelsPerCell, 'bufferPixelsPerCell');
  requirePositiveFinite(bufferWidthPx, 'bufferWidthPx');
  requirePositiveFinite(bufferHeightPx, 'bufferHeightPx');
  requireNonNegativeFinite(canvasCssWidth, 'canvasCssWidth');
  requireNonNegativeFinite(canvasCssHeight, 'canvasCssHeight');

  const cssToBuffer = bufferPixelsPerCell / viewport.scale;
  const srcLeft = (0 - viewport.originX) * cssToBuffer;
  const srcTop = (0 - viewport.originY) * cssToBuffer;
  const srcRight = (canvasCssWidth - viewport.originX) * cssToBuffer;
  const srcBottom = (canvasCssHeight - viewport.originY) * cssToBuffer;

  const sourceX = Math.max(0, srcLeft);
  const sourceY = Math.max(0, srcTop);
  const sourceWidth = Math.min(bufferWidthPx, srcRight) - sourceX;
  const sourceHeight = Math.min(bufferHeightPx, srcBottom) - sourceY;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const bufferToCss = viewport.scale / bufferPixelsPerCell;
  const destX = (viewport.originX + sourceX * bufferToCss) * viewport.dpr;
  const destY = (viewport.originY + sourceY * bufferToCss) * viewport.dpr;
  const destWidth = sourceWidth * bufferToCss * viewport.dpr;
  const destHeight = sourceHeight * bufferToCss * viewport.dpr;

  return { sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight };
}

/**
 * The `drawImage`/`clearRect` surface `blitStaticLayer` needs, with
 * `drawImage`'s image parameter bound to the real DOM `CanvasImageSource`
 * type. A real `CanvasRenderingContext2D` satisfies this directly; a test
 * fake reaches it through an `unknown` cast, the same pattern `layers.ts`
 * uses for `probeReadback`.
 */
export interface BlitContext2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/**
 * One frame of pan/zoom: clear the visible canvas and blit the static buffer
 * through `rects` — a single `drawImage` call, nothing per-segment. `rects`
 * is `null` when nothing overlaps (see `computeBlitRects`), in which case the
 * clear still runs so a previous frame's content doesn't linger.
 *
 * `ctx` must not be pre-scaled by device pixel ratio: `rects` and
 * `canvasDeviceWidthPx`/`canvasDeviceHeightPx` are already in raw device
 * pixels — the visible canvas's own `width`/`height` backing-store size, read
 * off the canvas itself rather than recomputed as `canvasCssWidth * dpr`:
 * allocating a canvas rounds that product to an integer, so the two can
 * differ by a device pixel and under-clear the edge.
 *
 * `canvasDeviceWidthPx`/`canvasDeviceHeightPx` accept zero: a canvas
 * mid-layout with no measured size yet is routine, not caller error, and the
 * frame is simply skipped.
 */
export function blitStaticLayer(
  ctx: BlitContext2D,
  image: CanvasLike,
  rects: BlitRects | null,
  canvasDeviceWidthPx: number,
  canvasDeviceHeightPx: number,
): void {
  requireNonNegativeFinite(canvasDeviceWidthPx, 'canvasDeviceWidthPx');
  requireNonNegativeFinite(canvasDeviceHeightPx, 'canvasDeviceHeightPx');
  if (canvasDeviceWidthPx === 0 || canvasDeviceHeightPx === 0) return;
  ctx.clearRect(0, 0, canvasDeviceWidthPx, canvasDeviceHeightPx);
  if (rects === null) return;
  // CanvasLike's declared shape can't prove it's a real image source, but the
  // canvas it wraps at runtime always is.
  ctx.drawImage(
    image as unknown as CanvasImageSource,
    rects.sourceX,
    rects.sourceY,
    rects.sourceWidth,
    rects.sourceHeight,
    rects.destX,
    rects.destY,
    rects.destWidth,
    rects.destHeight,
  );
}
