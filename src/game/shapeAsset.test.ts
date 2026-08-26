import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SHAPE_ASSET_FILE,
  SHAPE_MANIFEST_FILE,
  SHAPE_OUTLINE_FILE,
  decodeShapeLibrary,
} from './shapeLibrary.js';
import { shapeGenerateOptions } from './shapeBoard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOTICES = 'THIRD-PARTY-NOTICES.md';

function read(name: string): Buffer {
  return readFileSync(join(ROOT, 'public', name));
}

const approved = JSON.parse(
  readFileSync(join(ROOT, 'docs', 'shapes', 'approved.json'), 'utf8'),
) as { id: string; name: string }[];

const asset = read(SHAPE_ASSET_FILE);
const library = decodeShapeLibrary(
  read(SHAPE_MANIFEST_FILE).toString('utf8'),
  asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength) as ArrayBuffer,
  read(SHAPE_OUTLINE_FILE).toString('utf8'),
);

describe('the baked shape asset', () => {
  it('holds every approved shape, under the name the library shows', () => {
    expect(library.shapes).toEqual(approved);
  });

  it('is 96 cells square', () => {
    expect(library.edge).toBe(96);
  });

  it('has a drawing with ink in it for every shape', () => {
    for (const shape of library.shapes) {
      const ink = library.ink(shape.id);
      expect(ink?.length, shape.id).toBe(96 * 96);
      expect(
        ink?.some((cell) => cell === 1),
        shape.id,
      ).toBe(true);
    }
  });

  it('gives every shape a silhouette to cut a board from', () => {
    for (const shape of library.shapes) {
      const ink = library.ink(shape.id) as Uint8Array;
      expect(() => shapeGenerateOptions({ ink, edge: library.edge }, 78), shape.id).not.toThrow();
    }
  });
});

describe('the third-party notice', () => {
  it('is served by the built site as the same text the repo carries', () => {
    expect(read(NOTICES).toString('utf8')).toBe(readFileSync(join(ROOT, NOTICES), 'utf8'));
  });

  it('reproduces the copyright line and the permission grant', () => {
    const notices = readFileSync(join(ROOT, NOTICES), 'utf8');
    expect(notices).toContain('Copyright (c) 2023 Phosphor Icons');
    expect(notices).toContain('Permission is hereby granted, free of charge');
    expect(notices).toContain('WITHOUT WARRANTY OF ANY KIND');
  });
});
