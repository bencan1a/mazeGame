/**
 * The baked shape asset: its format, and the library that reads it.
 *
 * The asset is one packed bitmap per shape, one bit per cell, and the
 * manifest beside it names them. Both are static files the service worker
 * precaches, so the library is available offline after one visit and no
 * drawing is part of the JS bundle.
 */

import type { ShapeLibrary, ShapeOutline, ShapeSummary } from './shapes.js';

export const SHAPE_ASSET_FILE = 'shapes-v1.bin';
export const SHAPE_MANIFEST_FILE = 'shapes-v1.json';
export const SHAPE_OUTLINE_FILE = 'shapes-v1-outlines.json';

const MAGIC = 'AMSH';
export const SHAPE_ASSET_VERSION = 1;
const HEADER_BYTES = 12;

export interface ShapeManifest {
  readonly version: number;
  readonly edge: number;
  /** Where the drawings came from, for the notice the build ships beside them. */
  readonly source: string;
  readonly shapes: readonly ShapeManifestEntry[];
}

/** The artwork every bitmap was rasterised from, keyed by shape id. */
export interface ShapeOutlines {
  readonly version: number;
  readonly viewBox: number;
  readonly paths: Readonly<Record<string, string>>;
}

export interface ShapeManifestEntry extends ShapeSummary {
  /** Which bitmap in the asset is this shape's. Equals the entry's own position. */
  readonly index: number;
}

export function packedBytesPerShape(edge: number): number {
  return Math.ceil((edge * edge) / 8);
}

/** One bit per cell, cell `i` in bit `i & 7` of byte `i >> 3`. */
export function packInk(ink: Uint8Array): Uint8Array {
  const packed = new Uint8Array(Math.ceil(ink.length / 8));
  for (let i = 0; i < ink.length; i++) {
    if (ink[i] === 1) packed[i >> 3] = (packed[i >> 3] as number) | (1 << (i & 7));
  }
  return packed;
}

export function unpackInk(packed: Uint8Array, offset: number, cells: number): Uint8Array {
  const ink = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    ink[i] = ((packed[offset + (i >> 3)] as number) >> (i & 7)) & 1;
  }
  return ink;
}

export function encodeShapeAsset(edge: number, inks: readonly Uint8Array[]): Uint8Array {
  const stride = packedBytesPerShape(edge);
  const out = new Uint8Array(HEADER_BYTES + inks.length * stride);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  const view = new DataView(out.buffer);
  view.setUint16(4, SHAPE_ASSET_VERSION, true);
  view.setUint16(6, edge, true);
  view.setUint32(8, inks.length, true);
  inks.forEach((ink, at) => {
    if (ink.length !== edge * edge) {
      throw new Error(`shape ${at}: ink is ${ink.length} cells, expected ${edge * edge}`);
    }
    out.set(packInk(ink), HEADER_BYTES + at * stride);
  });
  return out;
}

/**
 * Reads the manifest and asset into a library, or throws saying which of the
 * two disagreed. Every field is checked because both files arrive over the
 * network from a cache that can hold a truncated or stale copy of either.
 */
export function decodeShapeLibrary(
  manifestText: string,
  asset: ArrayBuffer,
  outlineText: string,
): ShapeLibrary {
  const manifest = parseManifest(manifestText);
  const bytes = new Uint8Array(asset);
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`shape asset is ${bytes.length} bytes, too short to hold a header`);
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('shape asset is not a shape asset');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== SHAPE_ASSET_VERSION) {
    throw new Error(`shape asset is version ${version}, expected ${SHAPE_ASSET_VERSION}`);
  }
  const edge = view.getUint16(6, true);
  const count = view.getUint32(8, true);
  if (edge !== manifest.edge) {
    throw new Error(`shape asset is ${edge} cells square, manifest says ${manifest.edge}`);
  }
  if (count !== manifest.shapes.length) {
    throw new Error(`shape asset holds ${count} shapes, manifest names ${manifest.shapes.length}`);
  }
  const stride = packedBytesPerShape(edge);
  const expected = HEADER_BYTES + count * stride;
  if (bytes.length !== expected) {
    throw new Error(`shape asset is ${bytes.length} bytes, expected ${expected}`);
  }

  const outlines = parseOutlines(outlineText);
  for (const shape of manifest.shapes) {
    const path = outlines.paths[shape.id];
    if (path === undefined) throw new Error(`shape outlines have no drawing for "${shape.id}"`);
    if (typeof path !== 'string' || path === '') {
      throw new Error(`shape outlines hold no path for "${shape.id}"`);
    }
  }

  const indexById = new Map(manifest.shapes.map((shape) => [shape.id, shape.index]));
  return {
    shapes: manifest.shapes.map(({ id, name }): ShapeSummary => ({ id, name })),
    edge,
    ink(id: string): Uint8Array | null {
      const index = indexById.get(id);
      if (index === undefined) return null;
      return unpackInk(bytes, HEADER_BYTES + index * stride, edge * edge);
    },
    outline(id: string): ShapeOutline | null {
      const path = outlines.paths[id];
      return path === undefined ? null : { path, viewBox: outlines.viewBox };
    },
  };
}

function parseOutlines(text: string): ShapeOutlines {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('shape outlines are not an object');
  const { version, viewBox, paths } = raw as Record<string, unknown>;
  if (version !== SHAPE_ASSET_VERSION) {
    throw new Error(
      `shape outlines are version ${String(version)}, expected ${SHAPE_ASSET_VERSION}`,
    );
  }
  if (typeof viewBox !== 'number' || !Number.isFinite(viewBox) || viewBox <= 0) {
    throw new Error('shape outlines have no viewBox');
  }
  if (typeof paths !== 'object' || paths === null) throw new Error('shape outlines have no paths');
  return { version, viewBox, paths: paths as Record<string, unknown> as Record<string, string> };
}

/** Only ever called with a URL this module built, so it takes no request options. */
export type FetchUrl = (url: string) => Promise<Response>;

export interface LoadShapeLibraryOptions {
  /** Where the two files sit, usually the deployed base path. */
  readonly base?: string;
  readonly fetch?: FetchUrl;
}

export async function loadShapeLibrary(
  options: LoadShapeLibraryOptions = {},
): Promise<ShapeLibrary> {
  const base = options.base ?? defaultBase();
  const get: FetchUrl = options.fetch ?? ((url) => globalThis.fetch(url));
  const [manifest, asset, outlines] = await Promise.all([
    fetchOk(get, `${base}${SHAPE_MANIFEST_FILE}`).then((r) => r.text()),
    fetchOk(get, `${base}${SHAPE_ASSET_FILE}`).then((r) => r.arrayBuffer()),
    fetchOk(get, `${base}${SHAPE_OUTLINE_FILE}`).then((r) => r.text()),
  ]);
  return decodeShapeLibrary(manifest, asset, outlines);
}

async function fetchOk(get: FetchUrl, url: string): Promise<Response> {
  const response = await get(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response;
}

function defaultBase(): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function parseManifest(text: string): ShapeManifest {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('shape manifest is not an object');
  const { version, edge, source, shapes } = raw as Record<string, unknown>;
  if (version !== SHAPE_ASSET_VERSION) {
    throw new Error(
      `shape manifest is version ${String(version)}, expected ${SHAPE_ASSET_VERSION}`,
    );
  }
  if (typeof edge !== 'number' || !Number.isInteger(edge) || edge < 1) {
    throw new Error(`shape manifest edge is ${String(edge)}`);
  }
  if (!Array.isArray(shapes) || shapes.length === 0) {
    throw new Error('shape manifest names no shapes');
  }
  const entries = (shapes as unknown[]).map((entry: unknown, at: number): ShapeManifestEntry => {
    const { id, name, index } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string') {
      throw new Error(`shape manifest entry ${at} has no id and name`);
    }
    if (index !== at) throw new Error(`shape manifest entry ${at} claims index ${String(index)}`);
    return { id, name, index };
  });
  // Two entries under one id would leave the later one addressable and the
  // earlier one reachable only as the wrong drawing.
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`shape manifest names "${entry.id}" twice`);
    seen.add(entry.id);
  }
  return { version, edge, source: typeof source === 'string' ? source : '', shapes: entries };
}
