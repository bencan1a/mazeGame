import { describe, expect, it } from 'vitest';
import {
  SHAPE_ASSET_FILE,
  SHAPE_ASSET_VERSION,
  SHAPE_MANIFEST_FILE,
  SHAPE_OUTLINE_FILE,
  decodeShapeLibrary,
  encodeShapeAsset,
  loadShapeLibrary,
  packInk,
  packedBytesPerShape,
  unpackInk,
  type FetchUrl,
} from './shapeLibrary.js';

const EDGE = 8;
const CELLS = EDGE * EDGE;

function checkerInk(offset: number): Uint8Array {
  const ink = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) ink[i] = (i + offset) % 3 === 0 ? 1 : 0;
  return ink;
}

function manifest(ids: readonly string[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: SHAPE_ASSET_VERSION,
    edge: EDGE,
    source: 'test',
    shapes: ids.map((id, index) => ({ id, name: id, index })),
    ...overrides,
  });
}

function outlines(ids: readonly string[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: SHAPE_ASSET_VERSION,
    viewBox: 256,
    paths: Object.fromEntries(ids.map((id) => [id, 'M0 0H8V8H0Z'])),
    ...overrides,
  });
}

function assetOf(inks: readonly Uint8Array[]): ArrayBuffer {
  const bytes = encodeShapeAsset(EDGE, inks);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('packInk', () => {
  it('round-trips every cell through one bit each', () => {
    const ink = checkerInk(0);
    expect(unpackInk(packInk(ink), 0, CELLS)).toEqual(ink);
  });

  it('spends one bit per cell', () => {
    expect(packedBytesPerShape(96)).toBe(1152);
    expect(packInk(new Uint8Array(CELLS)).length).toBe(CELLS / 8);
  });
});

describe('decodeShapeLibrary', () => {
  const inks = [checkerInk(0), checkerInk(1), checkerInk(2)];
  const ids = ['one', 'two', 'three'];

  it('serves every shape the manifest names, in manifest order', () => {
    const library = decodeShapeLibrary(manifest(ids), assetOf(inks), outlines(ids));
    expect(library.shapes.map((shape) => shape.id)).toEqual(ids);
    expect(library.edge).toBe(EDGE);
  });

  it('gives back the bitmap that was packed for each id', () => {
    const library = decodeShapeLibrary(manifest(ids), assetOf(inks), outlines(ids));
    ids.forEach((id, at) => {
      expect(library.ink(id)).toEqual(inks[at]);
    });
  });

  it('has no drawing for an id the manifest does not name', () => {
    expect(
      decodeShapeLibrary(manifest(ids), assetOf(inks), outlines(ids)).ink('absent'),
    ).toBeNull();
  });

  it('rejects a truncated asset rather than serving a shape half of another', () => {
    const full = new Uint8Array(assetOf(inks));
    const cut = full.slice(0, full.length - 4);
    expect(() => decodeShapeLibrary(manifest(ids), cut.buffer, outlines(ids))).toThrow(/bytes/);
  });

  it('rejects an asset that is not a shape asset', () => {
    const bytes = new Uint8Array(64);
    expect(() => decodeShapeLibrary(manifest(ids), bytes.buffer, outlines(ids))).toThrow(
      /not a shape asset/,
    );
  });

  it('rejects an asset too short to hold a header', () => {
    expect(() => decodeShapeLibrary(manifest(ids), new ArrayBuffer(4), outlines(ids))).toThrow(
      /too short/,
    );
  });

  it('rejects a manifest naming a different number of shapes than the asset holds', () => {
    expect(() =>
      decodeShapeLibrary(manifest(['one', 'two']), assetOf(inks), outlines(ids)),
    ).toThrow(/holds 3/);
  });

  it('rejects a manifest from a different asset version', () => {
    expect(() =>
      decodeShapeLibrary(manifest(ids, { version: 99 }), assetOf(inks), outlines(ids)),
    ).toThrow(/version 99/);
  });

  it('rejects a manifest whose entries do not sit at the index they claim', () => {
    const shuffled = JSON.stringify({
      version: SHAPE_ASSET_VERSION,
      edge: EDGE,
      source: 'test',
      shapes: ids.map((id, index) => ({ id, name: id, index: index + 1 })),
    });
    expect(() => decodeShapeLibrary(shuffled, assetOf(inks), outlines(ids))).toThrow(
      /claims index/,
    );
  });

  it('rejects an outline that is not a path, rather than passing it to a renderer', () => {
    const broken = outlines(ids, {
      paths: { one: 42, two: 'M0 0H8V8H0Z', three: 'M0 0H8V8H0Z' },
    });
    expect(() => decodeShapeLibrary(manifest(ids), assetOf(inks), broken)).toThrow(/one/);
  });

  it('rejects a manifest naming one id twice, which would hide a shape behind another', () => {
    const twice = JSON.stringify({
      version: SHAPE_ASSET_VERSION,
      edge: EDGE,
      source: 'test',
      shapes: [
        { id: 'one', name: 'one', index: 0 },
        { id: 'one', name: 'again', index: 1 },
        { id: 'three', name: 'three', index: 2 },
      ],
    });
    expect(() => decodeShapeLibrary(twice, assetOf(inks), outlines(ids))).toThrow(/twice/);
  });

  it('rejects a manifest that is not JSON', () => {
    expect(() => decodeShapeLibrary('not json', assetOf(inks), outlines(ids))).toThrow();
  });
});

describe('loadShapeLibrary', () => {
  const inks = [checkerInk(0)];

  function serve(files: Record<string, string | ArrayBuffer>): FetchUrl {
    return (url: string) => {
      const body = files[url.slice(url.lastIndexOf('/') + 1)];
      if (body === undefined) return Promise.resolve({ ok: false, status: 404 } as Response);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(body as string),
        arrayBuffer: () => Promise.resolve(body as ArrayBuffer),
      } as Response);
    };
  }

  it('reads the manifest, the asset and the outlines from the base path', async () => {
    const library = await loadShapeLibrary({
      base: '/mazeGame/',
      fetch: serve({
        [SHAPE_MANIFEST_FILE]: manifest(['one']),
        [SHAPE_ASSET_FILE]: assetOf(inks),
        [SHAPE_OUTLINE_FILE]: outlines(['one']),
      }),
    });
    expect(library.shapes).toEqual([{ id: 'one', name: 'one' }]);
    expect(library.outline('one')?.path).toBe('M0 0H8V8H0Z');
  });

  it('rejects when the outlines are missing, naming the file that was not there', async () => {
    await expect(
      loadShapeLibrary({
        base: '/mazeGame/',
        fetch: serve({
          [SHAPE_MANIFEST_FILE]: manifest(['one']),
          [SHAPE_ASSET_FILE]: assetOf(inks),
        }),
      }),
    ).rejects.toThrow(SHAPE_OUTLINE_FILE);
  });

  it('rejects when the asset is missing, naming the file that was not there', async () => {
    await expect(
      loadShapeLibrary({
        base: '/',
        fetch: serve({ [SHAPE_MANIFEST_FILE]: manifest(['one']) }),
      }),
    ).rejects.toThrow(new RegExp(`${SHAPE_ASSET_FILE} -> 404`));
  });
});
