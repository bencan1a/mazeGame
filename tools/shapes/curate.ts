/**
 * The keep-list. An icon set is mostly not a library of things: brand marks,
 * letterforms, interface glyphs and chart furniture all have to go before
 * anyone judges whether a drawing is worth playing.
 *
 * Reads the Phosphor metadata module and prints the names that survive.
 *
 * Usage: npx tsx tools/shapes/curate.ts --meta <path to index.mjs> [--sample 48]
 */

import { pathToFileURL } from 'node:url';

interface IconMeta {
  readonly name: string;
  readonly categories?: readonly string[];
}

const BLOCKED_CATEGORIES = new Set([
  'brands',
  'arrows',
  'system',
  'editor',
  'design',
  'technology & development',
  'communications',
]);

const KEPT_CATEGORIES = new Set([
  'nature',
  'objects',
  'games',
  'maps & travel',
  'health & wellness',
  'weather',
]);

/** Things a category alone does not catch: symbols, currency, chart parts. */
const BLOCKED_NAMES =
  /(logo|number|letter|text|align|caret|arrow|chevron|cursor|selection|sort|toggle|dots|circle-half|square-half|placeholder|currency|trademark|copyright|registered|gender|chart|-sign|symbol|simple-circle|hemisphere)/;

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

export function keepList(icons: readonly IconMeta[]): string[] {
  return icons
    .filter((icon) => {
      const categories = icon.categories ?? [];
      if (categories.some((category) => BLOCKED_CATEGORIES.has(category))) return false;
      if (!categories.some((category) => KEPT_CATEGORIES.has(category))) return false;
      return !BLOCKED_NAMES.test(icon.name);
    })
    .map((icon) => icon.name);
}

const module: Record<string, unknown> = (await import(
  pathToFileURL(arg('--meta', 'ph-index.mjs')).href
)) as Record<string, unknown>;
const icons = Object.values(module).find(
  (value): value is IconMeta[] => Array.isArray(value) && value.length > 500,
);
if (icons === undefined) throw new Error('no icon array in that metadata module');

const kept = keepList(icons);
const sampleSize = Number(arg('--sample', '0'));
const chosen =
  sampleSize > 0
    ? kept.filter((_, index) => index % Math.max(1, Math.floor(kept.length / sampleSize)) === 0)
    : kept;
process.stderr.write(`${kept.length} of ${icons.length} kept\n`);
process.stdout.write(
  chosen.slice(0, sampleSize > 0 ? sampleSize : chosen.length).join('\n') + '\n',
);
