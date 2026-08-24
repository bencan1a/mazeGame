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
 * assumed already clamped by the caller — see `clampZoomScale`. The result
 * can still fall outside the pan bound: zooming out about a focal point near
 * one edge pushes the opposite edge past it. Follow with `clampPan`.
 *
 * A non-finite or non-positive `nextScale` is treated as no zoom information
 * for this frame rather than rejected: `clampZoomScale` can legitimately
 * resolve to exactly 0 (an unmeasured canvas's fit-to-canvas minimum is 0,
 * and a degenerate pinch clamps down to it), and this is the one call in the
 * documented pan/zoom composition that receives a clamp's output directly, so
 * it is the one that must absorb rather than throw on it.
 */
export function zoomViewportAt(
  viewport: Viewport<'css'>,
  nextScale: number,
  focalX: number,
  focalY: number,
): Viewport<'css'> {
  requireFinite(focalX, 'focalX');
  requireFinite(focalY, 'focalY');
  if (!Number.isFinite(nextScale) || nextScale <= 0) return viewport;
  const ratio = nextScale / viewport.scale;
  const originX = focalX - (focalX - viewport.originX) * ratio;
  const originY = focalY - (focalY - viewport.originY) * ratio;
  return { ...viewport, scale: nextScale, originX, originY };
}

/**
 * How far past the buffer's own achieved CSS px/cell (`bufferPixelsPerCell /
 * dpr`) `maxZoomScale` allows a magnified blit to go before it is scaling up
 * pixels rather than sampling detail the buffer holds. 1 keeps the ceiling at
 * that native resolution; a caller with headroom to spare can raise it.
 */
export const DEFAULT_MAX_UPSCALE = 1;

/**
 * CSS px/cell an arrowhead needs to read as a direction. A fallback for
 * callers that have not supplied the measured figure — pass the real value
 * once one is available, rather than relying on this approximation.
 */
export const DEFAULT_MIN_LEGIBLE_CSS_PIXELS_PER_CELL = 10;

/**
 * The zoom ceiling for `clampZoomScale`: the larger of `maxUpscale` times the
 * buffer's own achieved CSS px/cell and `minLegibleScale`, floored at
 * `minScale` so a small board's fit-to-canvas minimum is always within the
 * reachable range. Without the legibility floor, a badly degraded buffer
 * would cap zoom below `minScale` and lock the player out of ever reading an
 * arrowhead; the floor accepts blur there instead, since blurry-and-playable
 * beats crisp-and-unplayable. `bufferPixelsPerCell` is the buffer's own scale
 * (`Viewport<'buffer'>.scale`, buffer pixels per cell); dividing by `dpr`
 * converts it to the same CSS-px/cell units as `minScale`.
 */
export function maxZoomScale(
  minScale: number,
  bufferPixelsPerCell: number,
  dpr: number,
  maxUpscale: number = DEFAULT_MAX_UPSCALE,
  minLegibleScale: number = DEFAULT_MIN_LEGIBLE_CSS_PIXELS_PER_CELL,
): number {
  requireNonNegativeFinite(minScale, 'minScale');
  requirePositiveFinite(bufferPixelsPerCell, 'bufferPixelsPerCell');
  requirePositiveFinite(dpr, 'dpr');
  requirePositiveFinite(maxUpscale, 'maxUpscale');
  requirePositiveFinite(minLegibleScale, 'minLegibleScale');
  const nativeCssPixelsPerCell = (bufferPixelsPerCell / dpr) * maxUpscale;
  return Math.max(minScale, nativeCssPixelsPerCell, minLegibleScale);
}

/**
 * Clamps a requested scale between `minScale` and `maxScale` (see
 * `maxZoomScale`). `minScale` accepts zero: a fit-to-canvas minimum computed
 * against a canvas that hasn't been measured yet is legitimately zero, not
 * caller error. If `maxScale` is ever built some other way and ends up below
 * `minScale`, the result is `maxScale`.
 *
 * `scale` itself is never rejected, however degenerate: a pinch computes it
 * as a distance ratio, and two pointers coinciding or one lifting mid-gesture
 * yields exactly 0, Infinity, or NaN. A clamp's job is to resolve an
 * out-of-range input, not reject it, so 0 and either Infinity already land on
 * the nearer bound through `Math.min`/`Math.max`; NaN has no defined
 * position to compare and settles at `minScale`.
 */
export function clampZoomScale(scale: number, minScale: number, maxScale: number): number {
  requireNonNegativeFinite(minScale, 'minScale');
  requirePositiveFinite(maxScale, 'maxScale');
  if (minScale > maxScale) return maxScale;
  if (Number.isNaN(scale)) return minScale;
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
 * Takes the whole `bufferViewport` rather than only its `scale`, and honours
 * `originX`/`originY`: a buffer with padding around the board content (an
 * arrowhead overhang margin, say) places cell (0, 0) away from the buffer's
 * own pixel (0, 0), and dropping that offset would sample the wrong region
 * of the buffer with no type error to catch it. `bufferWidthPx`/
 * `bufferHeightPx` are the buffer canvas's own full pixel dimensions — the
 * bound the source rect is clipped to — independent of where the origin
 * places cell (0, 0) within them.
 */
export function computeBlitRects(
  viewport: Viewport<'css'>,
  bufferViewport: Viewport<'buffer'>,
  bufferWidthPx: number,
  bufferHeightPx: number,
  canvasCssWidth: number,
  canvasCssHeight: number,
): BlitRects | null {
  requirePositiveFinite(bufferWidthPx, 'bufferWidthPx');
  requirePositiveFinite(bufferHeightPx, 'bufferHeightPx');
  requireNonNegativeFinite(canvasCssWidth, 'canvasCssWidth');
  requireNonNegativeFinite(canvasCssHeight, 'canvasCssHeight');

  const cssToBuffer = bufferViewport.scale / viewport.scale;
  const srcLeft = bufferViewport.originX + (0 - viewport.originX) * cssToBuffer;
  const srcTop = bufferViewport.originY + (0 - viewport.originY) * cssToBuffer;
  const srcRight = bufferViewport.originX + (canvasCssWidth - viewport.originX) * cssToBuffer;
  const srcBottom = bufferViewport.originY + (canvasCssHeight - viewport.originY) * cssToBuffer;

  const sourceX = Math.max(0, srcLeft);
  const sourceY = Math.max(0, srcTop);
  const sourceWidth = Math.min(bufferWidthPx, srcRight) - sourceX;
  const sourceHeight = Math.min(bufferHeightPx, srcBottom) - sourceY;
  // An extreme viewport.scale (a valid positive finite number, just an
  // astronomically small one) can overflow this arithmetic to NaN or
  // Infinity, which a plain `<= 0` comparison never catches.
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const bufferToCss = viewport.scale / bufferViewport.scale;
  const destX =
    (viewport.originX + (sourceX - bufferViewport.originX) * bufferToCss) * viewport.dpr;
  const destY =
    (viewport.originY + (sourceY - bufferViewport.originY) * bufferToCss) * viewport.dpr;
  const destWidth = sourceWidth * bufferToCss * viewport.dpr;
  const destHeight = sourceHeight * bufferToCss * viewport.dpr;
  if (
    !Number.isFinite(destX) ||
    !Number.isFinite(destY) ||
    !Number.isFinite(destWidth) ||
    !Number.isFinite(destHeight)
  ) {
    return null;
  }

  return { sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight };
}

/**
 * The `save`/`setTransform`/`clearRect`/`drawImage`/`restore` surface
 * `blitStaticLayer` needs, with `drawImage`'s image parameter bound to the
 * real DOM `CanvasImageSource` type. A real `CanvasRenderingContext2D`
 * satisfies this directly; a test fake reaches it through an `unknown` cast.
 */
export interface BlitContext2D {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
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
 * `rects` and `canvasDeviceWidthPx`/`canvasDeviceHeightPx` are in raw device
 * pixels — the visible canvas's own `width`/`height` backing-store size, read
 * off the canvas itself rather than recomputed as `canvasCssWidth * dpr`:
 * allocating a canvas rounds that product to an integer, so the two can
 * differ by a device pixel and under-clear the edge. `ctx` is reset to the
 * identity transform before the clear and draw rather than assumed unscaled:
 * nothing in `BlitContext2D`'s type distinguishes an unscaled context from a
 * dpr-prescaled one, so a caller passing the wrong context would otherwise
 * blit and clear at the wrong scale with no type error to catch it.
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
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasDeviceWidthPx, canvasDeviceHeightPx);
    if (rects === null) return;
    // CanvasLike's declared shape can't prove it's a real image source, but
    // the canvas it wraps at runtime always is.
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
  } finally {
    ctx.restore();
  }
}
