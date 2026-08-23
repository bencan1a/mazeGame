/**
 * After a merge into `main`, assert the branch's tip actually landed.
 *
 * A push landing mid-merge (as on #48) can leave commits behind: branch
 * protection should close that window by invalidating the required check, and
 * this confirms it did rather than leaving it to be spotted by hand.
 *
 *   node scripts/verify-merge-landed.mjs <merge-sha>
 *
 * Exits non-zero, loudly, while the branch still exists to recover from.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY;
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = process.argv[2] ?? git('rev-parse', 'HEAD');
const short = (value) => value.slice(0, 7);

const res = await fetch(`${API}/repos/${REPO}/commits/${sha}/pulls`, {
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    'x-github-api-version': '2022-11-28',
  },
});
if (!res.ok) throw new Error(`GET commits/${sha}/pulls -> ${res.status} ${await res.text()}`);

const merged = (await res.json()).find((pr) => pr.merge_commit_sha === sha);

let ok = true;
let note;
if (!merged) {
  note = `\`${short(sha)}\` is not a PR merge commit; nothing to check.`;
} else {
  const ref = `origin/${merged.head.ref}`;
  let tip;
  try {
    tip = git('rev-parse', '--verify', `${ref}^{commit}`);
  } catch {
    note = `#${merged.number}: branch \`${merged.head.ref}\` is already deleted; nothing to check.`;
  }

  if (tip) {
    try {
      git('merge-base', '--is-ancestor', tip, sha);
      note = `#${merged.number}: \`main\` contains the branch tip \`${short(tip)}\`.`;
    } catch {
      ok = false;
      note =
        `**#${merged.number} merged as \`${short(sha)}\`, but its branch tip \`${short(tip)}\` is not ` +
        `in \`main\`.** Commits were pushed while the merge ran and did not land — this is how #48 ` +
        `lost a6435f1. Recover them from \`${merged.head.ref}\` before the branch is deleted.`;
    }
  }
}

console.log(note);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${note}\n`);
}
if (!ok) process.exit(1);
