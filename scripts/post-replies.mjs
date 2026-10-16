// Posts approved comment replies as Rook's GitHub account.
//
// Rook drafts each reply as replies/<issue>-<slug>.md in a pull request; merging
// it is the approval. On push to main this posts every reply file that isn't on
// its issue yet. Each posted comment carries a hidden marker naming its file,
// so re-runs never post twice.
//
// File format: front matter with `issue: <number>`, then the reply in Markdown.
//
// Env: ROOK_GITHUB_TOKEN (Rook's account), GITHUB_REPOSITORY (set by Actions).

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const { ROOK_GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
const DIR = 'replies';

if (!ROOK_GITHUB_TOKEN) {
  console.log('ROOK_GITHUB_TOKEN not set; skipping.');
  process.exit(0);
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${ROOK_GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body && { 'Content-Type': 'application/json' }),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function parse(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const issue = match?.[1].match(/^issue:\s*(\d+)\s*$/m)?.[1];
  const body = match?.[2].trim();
  if (!issue || !body) throw new Error(`${file}: needs front matter with "issue: <number>" and a body`);
  return { issue: Number(issue), body };
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && f !== 'README.md');

for (const file of files.sort()) {
  const { issue, body } = parse(await readFile(join(DIR, file), 'utf8'), file);
  const marker = `<!-- rook-reply: ${file} -->`;
  const comments = await gh(`/issues/${issue}/comments?per_page=100`);
  if (comments.some((c) => c.body?.includes(marker))) continue;
  await gh(`/issues/${issue}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `${body}\n\n${marker}` }),
  });
  console.log(`Posted ${file} to #${issue}`);
}
