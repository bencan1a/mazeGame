/**
 * Re-check open PRs against `main` after a merge, and verify the merge took the
 * branch's real tip.
 *
 * Runs from .github/workflows/base-moved.yml, in two modes:
 *
 *   node scripts/recheck-open-prs.mjs --select --before <sha> --after <sha>
 *     Picks the open PRs the merge could plausibly break (scripts/lib/
 *     pr-recheck.mjs decides), writes them to $GITHUB_OUTPUT as a job matrix,
 *     and asserts the just-merged branch is an ancestor of `main`. #48 merged
 *     the commit before three fixes pushed mid-merge, and nothing noticed.
 *
 *   node scripts/recheck-open-prs.mjs --status <sha> <state> <description>
 *     Posts the result of one re-check onto the PR's head commit.
 *
 * Nothing here pushes to a contributor's branch: the re-check merges `main` in
 * a throwaway checkout and reports a commit status. A push from GITHUB_TOKEN
 * would not have re-triggered CI anyway.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { selectAffected } from './lib/pr-recheck.mjs';

const REPO = process.env.GITHUB_REPOSITORY;
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const STATUS_CONTEXT = 'base-moved / verify against current main';
const OPT_OUT_LABEL = 'no-auto-recheck';
const MAX_FILE_PAGES = 3;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function api(path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summarise(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

if (flag('status')) {
  const [sha, state, ...rest] = argv.slice(argv.indexOf('--status') + 1);
  await api(`/repos/${REPO}/statuses/${sha}`, {
    method: 'POST',
    body: JSON.stringify({
      state,
      context: STATUS_CONTEXT,
      description: rest.join(' ').slice(0, 140),
      target_url: `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    }),
  });
  process.exit(0);
}

/**
 * A PR with more changed files than we will page through comes back as null;
 * the caller then treats it as affected rather than guessing it is safe.
 */
async function changedFiles(number) {
  const files = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const batch = await api(`/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`);
    files.push(...batch.map((file) => file.filename));
    if (batch.length < 100) return files;
  }
  return null;
}

/** @returns {string} a note for the run summary */
async function verifyMergeTookBranchTip(after) {
  const merged = (await api(`/repos/${REPO}/commits/${after}/pulls`)).find(
    (pr) => pr.merge_commit_sha === after,
  );
  if (!merged) return `No merged PR maps to \`${after.slice(0, 7)}\`; branch-tip check skipped.`;

  const ref = `origin/${merged.head.ref}`;
  try {
    git('rev-parse', '--verify', `${ref}^{commit}`);
  } catch {
    return `#${merged.number}: branch \`${merged.head.ref}\` is gone; branch-tip check skipped.`;
  }

  const tip = git('rev-parse', ref);
  try {
    git('merge-base', '--is-ancestor', tip, after);
    return `#${merged.number}: \`main\` contains the branch tip \`${tip.slice(0, 7)}\`.`;
  } catch {
    throw new Error(
      `#${merged.number} merged as \`${after.slice(0, 7)}\` but its branch tip \`${tip.slice(0, 7)}\` ` +
        `is not in main. Commits were pushed while the merge ran and did not land — this is how ` +
        `#48 lost a6435f1. Recover them before the branch is deleted.`,
    );
  }
}

const before = arg('before');
const after = arg('after') ?? git('rev-parse', 'HEAD');
const mergedFiles =
  before && !/^0+$/.test(before)
    ? git('diff', '--name-only', before, after).split('\n').filter(Boolean)
    : [];

const openPrs = (await api(`/repos/${REPO}/pulls?state=open&base=main&per_page=100`)).filter(
  (pr) => !pr.draft && !pr.labels.some((label) => label.name === OPT_OUT_LABEL),
);

const withFiles = [];
for (const pr of openPrs) {
  const files = await changedFiles(pr.number);
  withFiles.push({ number: pr.number, files: files ?? mergedFiles });
}

const { affected, skipped, reason } = selectAffected(mergedFiles, withFiles);
const matrix = affected.map((number) => {
  const pr = openPrs.find((candidate) => candidate.number === number);
  return { number, head: pr.head.sha, ref: pr.head.ref };
});

output('count', matrix.length);
output('matrix', JSON.stringify({ pr: matrix }));

let tipNote;
let failure;
try {
  tipNote = await verifyMergeTookBranchTip(after);
} catch (error) {
  failure = error;
  tipNote = `**${error.message}**`;
}

summarise(
  [
    `### Base moved to \`${after.slice(0, 7)}\``,
    '',
    `- open PRs: **${openPrs.length}**`,
    `- re-checked: **${affected.length}**${affected.length ? ` (${affected.map((n) => `#${n}`).join(', ')})` : ''} — ${
      reason === 'global'
        ? 'the merge changed a shared contract or build file'
        : 'their files overlap the merge'
    }`,
    `- left alone as unaffected: **${skipped.length}**`,
    `- ${tipNote}`,
  ].join('\n'),
);

if (failure) process.exit(1);
