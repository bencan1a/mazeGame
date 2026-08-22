/**
 * Which open PRs a merge into `main` can plausibly break.
 *
 * Shared by the live workflow (`scripts/recheck-open-prs.mjs`) and the cost
 * replay (`scripts/ci-cost.mjs`) so the number in docs/CI-COST.md describes
 * the policy that actually runs.
 */

/**
 * Paths whose change can break a PR that does not name them: the shared
 * contract files, and anything that reconfigures the whole build. #62 broke
 * this way — #53 changed `src/core/types.ts`, #57 never touched it, and the
 * pair did not compile.
 */
export const GLOBAL_PATHS = [
  'src/core/types.ts',
  'src/core/generate.ts',
  'src/core/rng.ts',
  'src/core/grid.ts',
  'test/fixtures/',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'eslint.config.js',
  'vite.config.ts',
  'vitest.config.ts',
  '.prettierrc.json',
  '.nvmrc',
  '.github/workflows/ci.yml',
];

export function touchesGlobalPath(files) {
  return files.some((f) => GLOBAL_PATHS.some((g) => (g.endsWith('/') ? f.startsWith(g) : f === g)));
}

export function filesIntersect(a, b) {
  const set = new Set(a);
  return b.some((f) => set.has(f));
}

/**
 * @param {string[]} mergedFiles files the merge into `main` changed
 * @param {{number: number, files: string[]}[]} openPrs
 * @returns {{affected: number[], skipped: number[], reason: 'global'|'overlap'}}
 */
export function selectAffected(mergedFiles, openPrs) {
  if (touchesGlobalPath(mergedFiles)) {
    return { affected: openPrs.map((p) => p.number), skipped: [], reason: 'global' };
  }
  const affected = [];
  const skipped = [];
  for (const pr of openPrs) {
    (filesIntersect(mergedFiles, pr.files) ? affected : skipped).push(pr.number);
  }
  return { affected, skipped, reason: 'overlap' };
}
