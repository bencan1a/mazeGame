/**
 * Convergence measurement, not a correctness test (that's localSearch.test.ts
 * and index.property.test.ts). This is the number issue #10 and R2
 * (docs/PLAN.md, docs/METRICS.md) actually ask for: how often does local
 * search converge, and how often would the reverse-construction fallback
 * (#11) actually fire, at the sizes the issue names.
 *
 * Two path sources, on purpose, because they give very different answers:
 *
 *  - `makePath` (boustrophedon): a trivial, maximally regular serpentine.
 *    Every sample here shares the exact same shape - only segmentation cuts
 *    vary by seed - so it is not a fair proxy for a real board.
 *  - `buildContourPath` (spanning-tree contour, S2, landed on `main` since
 *    this issue's original brief was written): the actual path method the
 *    generator uses, genuinely different in shape per seed via its own
 *    randomized spanning tree.
 *
 * They disagree sharply: on the boustrophedon fixture local search converges
 * at every size tried here; on a real contour path it does not converge at
 * *any* size tried here, because a bendy real path packs segments into a far
 * denser blocking graph - a single board-spanning SCC is typical, not rare -
 * which also makes each iteration itself markedly more expensive (see
 * localSearch.ts's `DEFAULT_MAX_ITERATIONS` comment). Measuring only the
 * boustrophedon fixture, as an earlier version of this file did, produced a
 * conclusion ("this box mostly works, growing it would mostly fix the
 * rest") that does not hold once real geometry is used.
 *
 * 100x100 is not measured with a real contour path here: at this box size it
 * costs seconds per seed (denser graph, more segments), which would make
 * this file the dominant cost of every `npm run verify` run. A one-off,
 * unautomated measurement for the report found 0/3 converged in 8-9s each -
 * consistent with the pattern below, not contradicting it.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { buildContourPath } from '../path/contour.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import type { HamiltonianPath } from '../types.js';
import { segmentPath } from '../segment/segmentPath.js';
import { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
import { occupancyFromSegments } from './occupancy.js';

interface Sample {
  readonly converged: boolean;
  readonly iterations: number;
}

function measure(path: HamiltonianPath, size: number, seedCount: number): Sample[] {
  const samples: Sample[] = [];
  for (let seed = 1; seed <= seedCount; seed++) {
    const params = { ...DEFAULT_GEN_PARAMS, gridSize: size, seed };
    const rng = createRng(seed);
    const segments = segmentPath(path, params, rng);
    const occupancy = occupancyFromSegments(segments, size, size);
    const result = orientByLocalSearch(segments, occupancy, size, size, rng);
    samples.push({ converged: result.converged, iterations: result.iterations });
  }
  return samples;
}

/** Real per-seed geometry: each seed's own spanning tree gives it a genuinely different path shape. */
function measureContourPerSeed(size: number, seedCount: number): Sample[] {
  const mask = makeMask({ width: size, height: size });
  const samples: Sample[] = [];
  for (let seed = 1; seed <= seedCount; seed++) {
    const rng = createRng(seed);
    const pathResult = buildContourPath(mask, rng);
    if (!pathResult.ok)
      throw new Error(`seed ${String(seed)} failed to tile: ${pathResult.reason}`);
    const params = { ...DEFAULT_GEN_PARAMS, gridSize: size, seed };
    const segments = segmentPath(pathResult.path, params, rng);
    const occupancy = occupancyFromSegments(segments, size, size);
    const result = orientByLocalSearch(segments, occupancy, size, size, rng);
    samples.push({ converged: result.converged, iterations: result.iterations });
  }
  return samples;
}

function report(label: string, samples: readonly Sample[]): number {
  const converged = samples.filter((s) => s.converged);
  const mean =
    converged.length > 0 ? converged.reduce((a, s) => a + s.iterations, 0) / converged.length : 0;
  const max = converged.length > 0 ? Math.max(...converged.map((s) => s.iterations)) : 0;
  console.info(
    `${label}: ${String(converged.length)}/${String(samples.length)} converged ` +
      `(fallback would fire ${String(samples.length - converged.length)} times); ` +
      `mean iterations-to-acyclic ${mean.toFixed(1)}, max ${String(max)} (box: ${String(DEFAULT_MAX_ITERATIONS)})`,
  );
  return converged.length;
}

// Seed counts are deliberately small: this branch's own CPU-bound tests
// running concurrently, under v8 coverage instrumentation, on a machine also
// running other agents' worktrees, produced wall times 5-10x an isolated
// run in practice. The qualitative findings below (0/N or N/N) are not
// close calls that a bigger sample would meaningfully sharpen - see this
// issue's report for larger, unautomated samples.
describe('boustrophedon (makePath): not representative, kept for contrast with the contour numbers below', () => {
  it('40x40, 20 seeds: converges reliably on this fixture', () => {
    const size = 40;
    const mask = makeMask({ width: size, height: size });
    const samples = measure(makePath(mask), size, 20);
    const converged = report('boustrophedon 40x40', samples);
    expect(converged).toBe(20);
  }, 30_000);

  it('70x70, 8 seeds: convergence collapses well before it does on real geometry', () => {
    const size = 70;
    const mask = makeMask({ width: size, height: size });
    const samples = measure(makePath(mask), size, 8);
    const converged = report('boustrophedon 70x70', samples);
    expect(converged).toBe(1);
  }, 45_000);

  it('100x100, 8 seeds', () => {
    const size = 100;
    const mask = makeMask({ width: size, height: size });
    const samples = measure(makePath(mask), size, 8);
    const converged = report('boustrophedon 100x100', samples);
    expect(converged).toBe(0);
  }, 60_000);
});

describe('real path geometry (buildContourPath): the honest number', () => {
  it('40x40, 8 seeds: does not converge even at the smallest size this issue measures', () => {
    const samples = measureContourPerSeed(40, 8);
    const converged = report('contour 40x40', samples);
    expect(converged).toBe(0);
  }, 45_000);

  it('70x70, 5 seeds', () => {
    const samples = measureContourPerSeed(70, 5);
    const converged = report('contour 70x70', samples);
    expect(converged).toBe(0);
  }, 90_000);
});
