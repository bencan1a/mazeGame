/**
 * Convergence measurement, not a correctness test (that's localSearch.test.ts
 * and index.property.test.ts). This is the number issue #10 and R2
 * (docs/PLAN.md, docs/METRICS.md) actually ask for: how often does local
 * search converge, how many flips does it take, and how often would the
 * reverse-construction fallback (#11) actually fire, at the two sizes the
 * issue names.
 *
 * `performance.now()` is a lint error in `src/core/` (ADR-0004) but this is a
 * test file measuring the algorithm from outside, not the algorithm itself
 * timing itself - the same distinction `blocking.test.ts`'s 100x100 timing
 * test relies on.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { segmentPath } from '../segment/segmentPath.js';
import { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
import { occupancyFromSegments } from './occupancy.js';

interface Sample {
  readonly converged: boolean;
  readonly iterations: number;
}

function measure(size: number, seedCount: number): Sample[] {
  const mask = makeMask({ width: size, height: size });
  const path = makePath(mask);
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

function report(label: string, samples: Sample[]): void {
  const converged = samples.filter((s) => s.converged);
  const convergedIterations = converged.map((s) => s.iterations);
  const mean =
    convergedIterations.length > 0
      ? convergedIterations.reduce((a, b) => a + b, 0) / convergedIterations.length
      : 0;
  const max = convergedIterations.length > 0 ? Math.max(...convergedIterations) : 0;
  console.info(
    `${label}: ${String(converged.length)}/${String(samples.length)} converged ` +
      `(fallback would fire ${String(samples.length - converged.length)} times); ` +
      `mean iterations-to-acyclic ${mean.toFixed(1)}, max ${String(max)} ` +
      `(box: ${String(DEFAULT_MAX_ITERATIONS)})`,
  );
}

// Seed counts here are sized down from an initial pass (150/40/25) that made
// this file itself the dominant cost of `npm run verify` and, by starving
// other workers of CPU under v8 coverage instrumentation, caused unrelated
// tests elsewhere in the suite to blow their own default timeouts. This is a
// measurement, not a correctness gate - fewer seeds costs precision on the
// mean/max, not validity of the qualitative finding (see this issue's
// report for the numbers this produced before the cut).
describe('convergence measurement (issue #10 / R2): default GenParams, DEFAULT_MAX_ITERATIONS box', () => {
  it('40x40, 40 seeds', () => {
    const samples = measure(40, 40);
    report('40x40', samples);
    for (const sample of samples)
      expect(sample.iterations).toBeLessThanOrEqual(DEFAULT_MAX_ITERATIONS);
  }, 20_000);

  it('70x70, 15 seeds', () => {
    const samples = measure(70, 15);
    report('70x70', samples);
    for (const sample of samples)
      expect(sample.iterations).toBeLessThanOrEqual(DEFAULT_MAX_ITERATIONS);
  }, 30_000);

  it('100x100, 12 seeds', () => {
    const samples = measure(100, 12);
    report('100x100', samples);
    for (const sample of samples)
      expect(sample.iterations).toBeLessThanOrEqual(DEFAULT_MAX_ITERATIONS);
  }, 45_000);
});
