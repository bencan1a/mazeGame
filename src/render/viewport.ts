/**
 * The board cell <-> pixel transform, shared by the static buffer, the
 * animation layer, pan/zoom, and hit testing. Every other module in
 * `src/render` composes this rather than deriving its own arithmetic.
 *
 * `scale` and `originX`/`originY` are in CSS pixels: the units a pointer
 * event or a canvas laid out with CSS reports. `dpr` converts between that
 * and device pixels, the units a canvas backing store is sized in.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  /** CSS pixels per board cell. */
  readonly scale: number;
  /** Device pixels per CSS pixel. */
  readonly dpr: number;
  /** CSS-pixel screen position of board cell (0, 0)'s top-left corner. */
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
export function createViewport(init: ViewportInit): Viewport {
  const scale = init.scale;
  const dpr = init.dpr ?? 1;
  const originX = init.originX ?? 0;
  const originY = init.originY ?? 0;
  requirePositiveFinite(scale, 'scale');
  requirePositiveFinite(dpr, 'dpr');
  requireFinite(originX, 'originX');
  requireFinite(originY, 'originY');
  return { scale, dpr, originX, originY };
}

/** Top-left corner of `cell`, in CSS pixels. */
export function cellToCssPixel(viewport: Viewport, cell: Cell): Point {
  return {
    x: viewport.originX + cell.x * viewport.scale,
    y: viewport.originY + cell.y * viewport.scale,
  };
}

/** Center of `cell`, in CSS pixels. */
export function cellCenterToCssPixel(viewport: Viewport, cell: Cell): Point {
  return { x: cellCenterX(viewport, cell.x), y: cellCenterY(viewport, cell.y) };
}

/**
 * X component of a cell's center, in CSS pixels, without allocating a Point —
 * for hot loops that would otherwise allocate one object per cell.
 */
export function cellCenterX(viewport: Viewport, cellX: number): number {
  return viewport.originX + cellX * viewport.scale + viewport.scale / 2;
}

/** Y component of a cell's center, in CSS pixels. See `cellCenterX`. */
export function cellCenterY(viewport: Viewport, cellY: number): number {
  return viewport.originY + cellY * viewport.scale + viewport.scale / 2;
}

/** The cell containing a CSS-pixel point. Not bounds-checked against the board. */
export function cssPixelToCell(viewport: Viewport, point: Point): Cell {
  return {
    x: Math.floor((point.x - viewport.originX) / viewport.scale),
    y: Math.floor((point.y - viewport.originY) / viewport.scale),
  };
}

export function cssPixelToDevicePixel(viewport: Viewport, point: Point): Point {
  return { x: point.x * viewport.dpr, y: point.y * viewport.dpr };
}

export function devicePixelToCssPixel(viewport: Viewport, point: Point): Point {
  return { x: point.x / viewport.dpr, y: point.y / viewport.dpr };
}

/** Top-left corner of `cell`, in device pixels. */
export function cellToDevicePixel(viewport: Viewport, cell: Cell): Point {
  return cssPixelToDevicePixel(viewport, cellToCssPixel(viewport, cell));
}

/** The cell containing a device-pixel point. Not bounds-checked against the board. */
export function devicePixelToCell(viewport: Viewport, point: Point): Cell {
  return cssPixelToCell(viewport, devicePixelToCssPixel(viewport, point));
}

/** Device pixels per board cell — `scale * dpr`. */
export function cellSizeInDevicePixels(viewport: Viewport): number {
  return viewport.scale * viewport.dpr;
}
