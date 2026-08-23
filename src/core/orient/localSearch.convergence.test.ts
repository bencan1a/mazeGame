/**
 * A convergence measurement, not a correctness test.
 *
 * Two path sources, because they give very different answers. A boustrophedon
 * fixture is one fixed shape — only the segmentation cuts vary by seed — and
 * local search converges on it at every size here. A real contour path
 * differs in shape per seed and converges at none of them: a bendy path packs
 * segments into a far denser blocking graph, typically one board-spanning
 * SCC, which also makes each iteration more expensive. Measuring only the
 * boustrophedon would say the iteration box mostly works, which real geometry
 * contradicts.
 *
 * 100x100 is not measured with a real contour path: it costs seconds per seed
 * and would dominate every verify run.
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
