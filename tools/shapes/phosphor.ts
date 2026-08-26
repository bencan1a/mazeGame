/**
 * The bake's source art. Nothing third-party is vendored: the tarball is
 * fetched from the registry at a pinned version, checked against a pinned
 * digest, and read in memory. What lands in the repo is our own bitmap plus
 * the notice this file also extracts.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const PHOSPHOR_VERSION = '2.1.1';
export const PHOSPHOR_PACKAGE = '@phosphor-icons/core';
const TARBALL_URL = `https://registry.npmjs.org/${PHOSPHOR_PACKAGE}/-/core-${PHOSPHOR_VERSION}.tgz`;

/**
 * sha256 of the published tarball. A registry tarball is immutable, so a
 * mismatch means the bytes are not the ones this bake was pinned to and the
 * asset would not reproduce.
 */
export const PHOSPHOR_TARBALL_SHA256 =
  '313332be6190b724da24107addd781799b48bf76b13963f24501112ffe1baadd';

const LICENSE_ENTRY = 'package/LICENSE';
const WEIGHT = 'thin';

export interface PhosphorSource {
  readonly version: string;
  /** The licence text as published, unmodified. */
  readonly license: string;
  /** The `thin` SVG for `id`, or null if the set has no such icon. */
  icon(id: string): string | null;
}

export async function openPhosphor(tarballPath?: string): Promise<PhosphorSource> {
  const tarball = tarballPath === undefined ? await download() : readFileSync(tarballPath);
  const digest = createHash('sha256').update(tarball).digest('hex');
  if (digest !== PHOSPHOR_TARBALL_SHA256) {
    throw new Error(
      `${PHOSPHOR_PACKAGE}@${PHOSPHOR_VERSION}: expected sha256 ${PHOSPHOR_TARBALL_SHA256}, ` +
        `got ${digest}`,
    );
  }

  const entries = readTar(gunzipSync(tarball));
  const license = entries.get(LICENSE_ENTRY);
  if (license === undefined) throw new Error(`${LICENSE_ENTRY} missing from the tarball`);
  const decoder = new TextDecoder();

  return {
    version: PHOSPHOR_VERSION,
    license: decoder.decode(license),
    icon(id: string): string | null {
      const svg = entries.get(`package/assets/${WEIGHT}/${id}-${WEIGHT}.svg`);
      return svg === undefined ? null : decoder.decode(svg);
    },
  };
}

async function download(): Promise<Buffer> {
  const response = await fetch(TARBALL_URL);
  if (!response.ok) throw new Error(`GET ${TARBALL_URL} -> ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Enough of the ustar format to read a registry tarball: regular files only,
 * 512-byte headers, data padded to the next 512-byte boundary. npm packs some
 * paths twice, once with a `./` segment in them; the plain spelling wins.
 */
function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    const name = cstring(header.subarray(0, 100));
    if (name === '') break;
    const size = Number.parseInt(cstring(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156] as number);
    if (type === '0' || type === '\0') {
      const normalised = name.replace(/(^|\/)\.\//g, '$1');
      if (!files.has(normalised)) files.set(normalised, tar.subarray(at + 512, at + 512 + size));
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function cstring(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('latin1');
}
