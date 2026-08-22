#!/usr/bin/env node
/**
 * Seeds GitHub with the labels, milestones, and issues in scripts/backlog.json,
 * and renders the readable index at docs/backlog.md.
 *
 * Idempotent: existing labels, milestones, and issues (matched by name/title)
 * are left alone, so re-running after editing the backlog only adds what is new.
 *
 *   node scripts/seed-github.mjs --render          # write docs/backlog.md only
 *   node scripts/seed-github.mjs --dry-run         # show what would be created
 *   node scripts/seed-github.mjs --repo owner/name # create for real
 *
 * Auth: GH_TOKEN or GITHUB_TOKEN, with `repo` scope.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const backlog = JSON.parse(readFileSync(join(here, 'backlog.json'), 'utf8'));

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const dryRun = has('--dry-run');
const repo = valueOf('--repo', process.env.GITHUB_REPOSITORY ?? 'bencan1a/mazeGame');
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

function issueBody(issue) {
  const criteria = issue.criteria.map((c) => `- [ ] ${c}`).join('\n');
  return [
    issue.context,
    '',
    '## Acceptance criteria',
    '',
    criteria,
    '',
    '---',
    '',
    'Read `docs/WORKFLOW.md` before starting. Claim by assigning yourself.',
    `Branch: \`agent/<stream>/<issue-number>-${issue.key}\``,
  ].join('\n');
}

function render() {
  const byWave = new Map();
  for (const issue of backlog.issues) {
    const wave = issue.labels.find((l) => l.startsWith('wave:')) ?? 'wave:?';
    if (!byWave.has(wave)) byWave.set(wave, []);
    byWave.get(wave).push(issue);
  }

  const lines = [
    '# Backlog',
    '',
    '<!-- Generated from scripts/backlog.json by scripts/seed-github.mjs --render. Edit the JSON, not this file. -->',
    '',
    'Readable index of the work. **GitHub Issues are the source of truth** once seeded',
    '(ADR-0005) — this file is the seed and a map, not a status board.',
    '',
    'Seed or reconcile:',
    '',
    '```sh',
    'node scripts/seed-github.mjs --dry-run   # preview',
    'node scripts/seed-github.mjs             # create what is missing',
    '```',
    '',
    `${backlog.issues.length} issues, ${backlog.milestones.length} milestones, ${backlog.labels.length} labels.`,
    '',
    '## Milestones',
    '',
    '| Milestone | Meaning |',
    '|---|---|',
    ...backlog.milestones.map((m) => `| ${m.title} | ${m.description} |`),
    '',
  ];

  for (const wave of [...byWave.keys()].sort()) {
    const issues = byWave.get(wave);
    lines.push(`## ${wave.replace('wave:', 'Wave ')}`, '');
    for (const issue of issues) {
      const stream = issue.labels.find((l) => l.startsWith('stream:')) ?? '';
      const tags = issue.labels
        .filter((l) => !l.startsWith('wave:') && !l.startsWith('stream:'))
        .map((l) => `\`${l}\``)
        .join(' ');
      lines.push(`### ${issue.title}`, '');
      lines.push(`\`${stream}\` · ${issue.milestone}${tags ? ` · ${tags}` : ''}`, '');
      lines.push(issue.context, '');
      lines.push('**Acceptance criteria**', '');
      lines.push(...issue.criteria.map((c) => `- [ ] ${c}`), '');
    }
  }

  writeFileSync(join(root, 'docs/backlog.md'), lines.join('\n'));
  console.log(`rendered docs/backlog.md (${backlog.issues.length} issues)`);
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function seed() {
  if (!token && !dryRun) {
    console.error('Set GH_TOKEN or GITHUB_TOKEN (repo scope), or pass --dry-run.');
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] repo ${repo}`);
    for (const l of backlog.labels) console.log(`[dry-run] label    ${l.name}`);
    for (const m of backlog.milestones) console.log(`[dry-run] milestone ${m.title}`);
    for (const i of backlog.issues) console.log(`[dry-run] issue    ${i.title}`);
    return;
  }

  const existingLabels = new Set(
    (await api(`/repos/${repo}/labels?per_page=100`)).map((l) => l.name),
  );
  for (const label of backlog.labels) {
    if (existingLabels.has(label.name)) continue;
    await api(`/repos/${repo}/labels`, { method: 'POST', body: JSON.stringify(label) });
    console.log(`label      + ${label.name}`);
  }

  const milestones = await api(`/repos/${repo}/milestones?state=all&per_page=100`);
  const milestoneNumber = new Map(milestones.map((m) => [m.title, m.number]));
  for (const milestone of backlog.milestones) {
    if (milestoneNumber.has(milestone.title)) continue;
    const created = await api(`/repos/${repo}/milestones`, {
      method: 'POST',
      body: JSON.stringify(milestone),
    });
    milestoneNumber.set(milestone.title, created.number);
    console.log(`milestone  + ${milestone.title}`);
  }

  const existingIssues = new Set();
  for (let page = 1; ; page++) {
    const batch = await api(`/repos/${repo}/issues?state=all&per_page=100&page=${page}`);
    for (const issue of batch) existingIssues.add(issue.title);
    if (batch.length < 100) break;
  }

  for (const issue of backlog.issues) {
    if (existingIssues.has(issue.title)) {
      console.log(`issue      = ${issue.title} (exists)`);
      continue;
    }
    const body = {
      title: issue.title,
      body: issueBody(issue),
      labels: issue.labels,
    };
    const number = milestoneNumber.get(issue.milestone);
    if (number !== undefined) body.milestone = number;
    await api(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify(body) });
    console.log(`issue      + ${issue.title}`);
  }
}

render();
if (!has('--render')) await seed();
