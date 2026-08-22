/**
 * What re-checking open PRs on every merge would have cost, replayed against
 * this repo's real merge history.
 *
 * Answers the acceptance criterion on issue #66: "how many extra CI runs a
 * merge triggers with N PRs open". Re-run it after a busy session to see
 * whether the filtered policy is still worth its complexity.
 *
 *   node scripts/ci-cost.mjs [--since <rev>] [--json]
 *
 * PR windows come from git alone, so this runs offline: a PR counts as open
 * from the commit date of the first commit on its branch until its merge
 * lands. That is a slight over-estimate — a branch usually has commits before
 * the PR is opened — which is the safe direction for a cost bound.
 */
import { execFileSync } from 'node:child_process';
import { selectAffected, touchesGlobalPath } from './lib/pr-recheck.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = (s) => (s ? s.split('\n').filter(Boolean) : []);

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const sinceIdx = argv.indexOf('--since');
const since = sinceIdx === -1 ? null : argv[sinceIdx + 1];
const range = since ? `${since}..HEAD` : 'HEAD';

const merges = [];
for (const line of lines(git('log', '--first-parent', '--format=%H %ct %s', range))) {
  const [sha, ts, ...rest] = line.split(' ');
  const match = /^Merge pull request #(\d+)/.exec(rest.join(' '));
  if (!match) continue;

  let secondParent;
  try {
    secondParent = git('rev-parse', `${sha}^2`);
  } catch {
    continue; // a fast-forward or squash merge has no branch side to diff
  }
  const firstParent = git('rev-parse', `${sha}^1`);
  const base = git('merge-base', firstParent, secondParent);
  const branchCommits = lines(git('log', '--format=%ct', `${base}..${secondParent}`));

  merges.push({
    number: Number(match[1]),
    sha,
    mergedAt: Number(ts),
    openedAt: branchCommits.length ? Number(branchCommits[branchCommits.length - 1]) : Number(ts),
    mergedFiles: lines(git('diff', '--name-only', firstParent, sha)),
    prFiles: lines(git('diff', '--name-only', base, secondParent)),
  });
}
merges.sort((a, b) => a.mergedAt - b.mergedAt);

const rows = merges.map((merge) => {
  const openPrs = merges.filter(
    (other) =>
      other.number !== merge.number &&
      other.openedAt <= merge.mergedAt &&
      other.mergedAt > merge.mergedAt,
  );
  const { affected } = selectAffected(
    merge.mergedFiles,
    openPrs.map((other) => ({ number: other.number, files: other.prFiles })),
  );
  return {
    pr: merge.number,
    open: openPrs.length,
    rechecked: affected.length,
    global: touchesGlobalPath(merge.mergedFiles),
  };
});

const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
const naive = sum('open');
const filtered = sum('rechecked');
const maxOpen = rows.reduce((max, row) => Math.max(max, row.open), 0);
const summary = {
  merges: rows.length,
  maxOpenAtOnce: maxOpen,
  meanOpenPerMerge: rows.length ? +(naive / rows.length).toFixed(2) : 0,
  naiveExtraRuns: naive,
  filteredExtraRuns: filtered,
  saved: naive - filtered,
};

if (asJson) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log('| PR merged | open PRs | re-checked | merge touched a global path |');
  console.log('| --------- | -------- | ---------- | --------------------------- |');
  for (const row of rows) {
    console.log(`| #${row.pr} | ${row.open} | ${row.rechecked} | ${row.global ? 'yes' : 'no'} |`);
  }
  console.log('');
  for (const [key, value] of Object.entries(summary)) console.log(`${key}: ${value}`);
}
