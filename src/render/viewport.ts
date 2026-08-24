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
