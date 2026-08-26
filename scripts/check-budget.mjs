#!/usr/bin/env node
/**
 * Bundle size budget.
 *
 * Every byte is precached on a phone, so bundle growth is one of the few
 * performance signals CI can produce on its own. A regression guard, not a
 * substitute for measuring on a device.
 *
 *   npm run build && node scripts/check-budget.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/**
 * Gzipped kB. Raise deliberately, with a note saying what bought the bytes.
 *
 * `.bin` and `.json` are the shape library: the bitmaps a board is cut from,
 * the drawings' own outlines for showing a shape to a player, and the manifest
 * naming them. They are not script, so they cost nothing to parse, but the
 * service worker precaches them like everything else — a phone downloads them
 * once before the game is playable offline, and nothing else in CI would
 * notice them growing.
 *
 * The `.json` budget covers ~54 kB of outline geometry for 309 shapes. It grows
 * with the library, at roughly 175 bytes a shape.
 */
const BUDGETS = { '.js': 220, '.css': 30, '.bin': 120, '.json': 90 };

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let files;
try {
  files = walk(dist);
} catch {
  console.error('No dist/ — run `npm run build` first.');
  process.exit(1);
}

const totals = {};
const rows = [];
for (const file of files) {
  const ext = extname(file);
  // The build writes its own manifests next to the assets; only what the app
  // actually downloads counts against a budget.
  if (!(ext in BUDGETS) || file.endsWith('.map') || file.endsWith('.webmanifest')) continue;
  const gzipped = gzipSync(readFileSync(file)).length / 1024;
  totals[ext] = (totals[ext] ?? 0) + gzipped;
  rows.push([relative(dist, file), gzipped]);
}

rows.sort((a, b) => b[1] - a[1]);
for (const [name, kb] of rows) console.log(`  ${kb.toFixed(1).padStart(7)} kB  ${name}`);

let failed = false;
for (const [ext, budget] of Object.entries(BUDGETS)) {
  const used = totals[ext] ?? 0;
  const verdict = used > budget ? 'OVER BUDGET' : 'ok';
  console.log(`${ext}: ${used.toFixed(1)} kB gzipped / ${budget} kB budget — ${verdict}`);
  if (used > budget) failed = true;
}

if (failed) {
  console.error('\nBundle budget exceeded. Either trim it, or raise the budget in');
  console.error('scripts/check-budget.mjs with a note saying what bought the bytes.');
  process.exit(1);
}
