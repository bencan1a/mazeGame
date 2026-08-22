#!/usr/bin/env node
/**
 * Bundle size budget.
 *
 * Offline is a first-class requirement and every byte is precached on a phone,
 * so bundle growth is one of the few genuinely useful performance signals CI
 * can produce on its own. It is a regression guard, not a substitute for the
 * device measurements in docs/TESTING.md.
 *
 *   npm run build && node scripts/check-budget.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Gzipped kB. Raise deliberately, with a note saying what bought the bytes. */
const BUDGETS = { '.js': 220, '.css': 30 };

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
  if (!(ext in BUDGETS) || file.endsWith('.map')) continue;
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
