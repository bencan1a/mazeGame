#!/usr/bin/env node
/**
 * Seeds GitHub with the labels, milestones, and issues in scripts/backlog.json,
 * and renders a readable local index at docs/backlog.md (gitignored — the
 * issues are the source of truth, so a committed copy would only drift).
 *
 * Idempotent and reconciling. Issues are matched by title and never rewritten,
 * but labels have their colour and description brought into line, and issues
 * missing their milestone get it attached. That matters because issues seeded
 * through the GitHub MCP tools (which cannot create labels or milestones) come
 * out with auto-generated label colours and no milestone — running this once
 * locally, with a real token, finishes the job.
 *
 *   node scripts/seed-github.mjs --render          # write docs/backlog.md only
 *   node scripts/seed-github.mjs --dry-run         # show what would be created
 *   node scripts/seed-github.mjs --repo owner/name # create for real
 *   node scripts/seed-github.mjs --rewrite-bodies  # also repair generated bodies
 *
 * Auth: GH_TOKEN or GITHUB_TOKEN, with `repo` scope.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const rewriteBodies = has('--rewrite-bodies');
const repo = valueOf('--repo', process.env.GITHUB_REPOSITORY ?? 'bencan1a/mazeGame');
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

export function issueBody(issue) {
  const criteria = issue.criteria.map((c) => `- [ ] ${c}`).join('\n');
  const stream = issue.labels.find((l) => l.startsWith('stream:')) ?? '';
  const wave = issue.labels.find((l) => l.startsWith('wave:')) ?? '';
  const streamName = stream.replace('stream:', '') || '<stream>';
  return [
    `**${issue.milestone}** · \`${stream}\` · \`${wave}\``,
    '',
    issue.context,
    '',
    '## Acceptance criteria',
    '',
    criteria,
    '',
    '---',
    '',
    'Read `docs/WORKFLOW.md` before starting. Claim by assigning yourself.',
    // Braces, not angle brackets: a <placeholder> is stripped as an HTML tag
    // when an issue is written through the GitHub MCP tools, which silently
    // turned this line into `agent//-key` the first time round.
    `Branch: \`agent/${streamName}/{issue-number}-${issue.key}\``,
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
    'Readable index of the work. **GitHub Issues are the source of truth**',
    '(ADR-0005) — this file is the seed and a map, not a status board. Issues',
    'are seeded; go to the issue for current status, assignee, and discussion.',
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

  const existingLabels = new Map(
    (await api(`/repos/${repo}/labels?per_page=100`)).map((l) => [l.name, l]),
  );
  for (const label of backlog.labels) {
    const current = existingLabels.get(label.name);
    if (!current) {
      await api(`/repos/${repo}/labels`, { method: 'POST', body: JSON.stringify(label) });
      console.log(`label      + ${label.name}`);
      continue;
    }
    // Labels auto-created by an issue write get a random colour and no
    // description. Bring them into line rather than leaving the board unreadable.
    if (current.color !== label.color || (current.description ?? '') !== label.description) {
      await api(`/repos/${repo}/labels/${encodeURIComponent(label.name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ color: label.color, description: label.description }),
      });
      console.log(`label      ~ ${label.name} (colour/description)`);
    }
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

  const existingIssues = new Map();
  for (let page = 1; ; page++) {
    const batch = await api(`/repos/${repo}/issues?state=all&per_page=100&page=${page}`);
    for (const issue of batch) existingIssues.set(issue.title, issue);
    if (batch.length < 100) break;
  }

  for (const issue of backlog.issues) {
    const current = existingIssues.get(issue.title);
    if (current) {
      // Never rewrite an issue by default — someone may be working in it.
      // --rewrite-bodies is the opt-in for repairing a bad generated body, and
      // it still refuses to touch an issue somebody has claimed.
      if (rewriteBodies) {
        const wantedBody = issueBody(issue);
        if (current.assignees?.length) {
          console.log(`issue      ! #${current.number} assigned — body left alone`);
        } else if (current.body !== wantedBody) {
          await api(`/repos/${repo}/issues/${current.number}`, {
            method: 'PATCH',
            body: JSON.stringify({ body: wantedBody }),
          });
          console.log(`issue      ~ #${current.number} ${issue.title} (body)`);
        }
      }
      const wanted = milestoneNumber.get(issue.milestone);
      if (wanted !== undefined && current.milestone?.number !== wanted) {
        await api(`/repos/${repo}/issues/${current.number}`, {
          method: 'PATCH',
          body: JSON.stringify({ milestone: wanted }),
        });
        console.log(`issue      ~ #${current.number} ${issue.title} (milestone)`);
      } else {
        console.log(`issue      = ${issue.title} (exists)`);
      }
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

// Only act when run directly — the module is imported by tooling that wants
// issueBody() without triggering a network call.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  render();
  if (!has('--render')) await seed();
}
