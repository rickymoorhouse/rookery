#!/usr/bin/env node
// Rook's weekly run, from your own machine.
//
// Does what the "Rook weekly post" scheduled task and the weekly run in
// CLAUDE.md describe: read last week's numbers, draft replies to new reader
// comments, then write this Thursday's post. Each result is pushed to a
// claude/ branch as Rook, where .github/workflows/open-pr.yml opens the pull
// request and assigns it to Ricky.
//
// The writing is done by Claude through the Anthropic API. If an API call
// fails, the run carries on with a local model through an OpenAI-compatible
// endpoint such as Ollama, and the PR says so.
//
// Usage: node rook.mjs [--check] [--dry-run] [--only=post|replies] [--date=yyyy-mm-dd]
// Settings: see README.md and .env.example.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { makeTools, runAgent } from './lib/agent.mjs';
import { enclosingProject, loadConfig } from './lib/config.mjs';
import { git as makeGit } from './lib/git.mjs';
import { github } from './lib/github.mjs';
import { Models } from './lib/models.mjs';
import { run } from './lib/proc.mjs';
import { postPrompt, repliesPrompt, systemPrompt } from './lib/prompts.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [key, value] = a.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);
const config = loadConfig();
const dryRun = Boolean(args['dry-run']);

// ---------- dates ----------

function ymd(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const now = args.date ? new Date(`${args.date}T12:00:00`) : new Date();
const today = ymd(now);
// This week's Thursday: today if it is Thursday, otherwise the next one.
const thursday = ymd(new Date(now.getTime() + ((4 - now.getDay() + 7) % 7) * 86_400_000));

// ---------- logging ----------

mkdirSync(config.logDir, { recursive: true });
const logFile = join(config.logDir, `${today}.log`);
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  appendFileSync(logFile, `${line}\n`);
}

// ---------- checks ----------

function homeProblem() {
  const outer = enclosingProject(config.home);
  return outer && `ROOK_HOME (${config.home}) is inside another project (${outer}), so the site build in its clone picks up the wrong tsconfig and fails. Set ROOK_HOME to a folder outside any project, such as ~/.rookery-runner.`;
}

async function check() {
  let ok = true;
  const say = (good, message) => {
    console.log(`${good ? 'ok  ' : 'FAIL'} ${message}`);
    ok &&= good;
  };
  const problem = homeProblem();
  say(!problem, problem || `Clone and logs in ${config.home}`);
  say(Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node} (needs 20+)`);
  if (!config.githubToken) say(false, 'ROOK_GITHUB_TOKEN is not set');
  else {
    try {
      const me = await github(config.githubToken, config.repo).request('/user');
      const repo = await github(config.githubToken, config.repo).request('/{repo}');
      say(true, `GitHub: signed in as ${me.login}, can see ${repo.full_name}`);
    } catch (e) {
      say(false, `GitHub: ${e.message}`);
    }
  }
  if (!config.anthropicApiKey) console.log('note ANTHROPIC_API_KEY is not set: every run will use the local model');
  else {
    try {
      const model = await new Anthropic({ apiKey: config.anthropicApiKey }).models.retrieve(config.model);
      say(true, `Anthropic API: ${model.id} available`);
    } catch (e) {
      say(false, `Anthropic API: ${e.message}`);
    }
  }
  if (!config.localModel) console.log('note No local model configured: there is no fallback if the Anthropic API fails');
  else {
    try {
      const res = await fetch(`${config.localBaseUrl}/models`, {
        headers: config.localApiKey ? { Authorization: `Bearer ${config.localApiKey}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
      const ids = (await res.json()).data?.map((m) => m.id) ?? [];
      say(ids.includes(config.localModel), `Local model: ${config.localModel} ${ids.includes(config.localModel) ? 'available' : `not found at ${config.localBaseUrl} (have: ${ids.join(', ') || 'none'})`}`);
    } catch (e) {
      say(false, `Local model: can't reach ${config.localBaseUrl} (${e.message})`);
    }
  }
  return ok;
}

// ---------- context ----------

function frontMatter(source) {
  const block = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const field = (name) => block.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return { block, field };
}

async function readPosts(root) {
  const dir = join(root, 'src/content/posts');
  const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}-.*\.mdx?$/.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const { field } = frontMatter(await readFile(join(dir, file), 'utf8'));
      return { file, title: field('title'), description: field('description'), pubDate: field('pubDate') };
    }),
  );
}

async function readStats(g) {
  try {
    await g.fetch('stats');
  } catch {
    return { report: null, note: 'there is no stats branch yet' };
  }
  const report = await g.show('origin/stats:latest.md');
  if (!report) return { report: null, note: 'latest.md is missing from the stats branch' };
  const { stdout: when } = await g.run('log', '-1', '--format=%cI', 'origin/stats');
  const ageDays = (now - new Date(when)) / 86_400_000;
  return { report, note: ageDays > 8 ? `The report is stale: last written ${when.slice(0, 10)}.` : null };
}

// Comments on the `comments` issues that Rook hasn't answered: anything newer
// than Rook's last comment on that issue, and newer than any open Replies PR.
async function newComments(gh, me) {
  const pulls = await gh.all('/{repo}/pulls?state=open');
  const openReplies = pulls.filter((p) => p.title.startsWith('Replies:')).map((p) => p.created_at).sort().pop();
  const issues = (await gh.all('/{repo}/issues?labels=comments&state=open')).filter((i) => !i.pull_request);
  const found = [];
  for (const issue of issues) {
    if (!issue.comments) continue;
    const comments = await gh.all(`/{repo}/issues/${issue.number}/comments`);
    const rookLast = comments.filter((c) => c.user?.login === me.login).map((c) => c.created_at).sort().pop();
    const cutoff = [rookLast, openReplies].filter(Boolean).sort().pop() ?? '';
    for (const c of comments) {
      if (c.user?.login === me.login || c.created_at <= cutoff) continue;
      found.push({
        issue: issue.number,
        issueTitle: issue.title.replace(/"/g, "'"),
        author: c.user?.login ?? 'unknown',
        createdAt: c.created_at,
        url: c.html_url,
        body: c.body ?? '',
      });
    }
  }
  return found;
}

// ---------- tasks ----------

function prBody(description, models) {
  const lines = [description, '', '---', `Drafted on Ricky's machine by the Rookery runner, using ${models.describe()}.`];
  if (models.usingLocal && models.client) {
    lines.push(`The Anthropic API failed during this run (${models.fallbackReason}), so some or all of this was written by the local model. Review it more closely than usual.`);
  } else if (models.usingLocal) {
    lines.push('No Anthropic API key was set, so this was written by the local model. Review it more closely than usual.');
  }
  return lines.join('\n');
}

async function finishTask({ g, me, branch, result, models, allowed }) {
  if (result.skip) {
    log(`Nothing to submit: ${result.description.split('\n')[0]}`);
    return;
  }
  const stray = (await g.changedFiles()).filter((f) => !allowed.some((r) => r.test(f.path)));
  if (stray.length) throw new Error(`Unexpected changes, not pushing: ${stray.map((f) => f.path).join(', ')}`);
  const message = `${result.title}\n\n${prBody(result.description, models)}\n`;
  await g.commit(message, { name: me.name || me.login, email: `${me.id}+${me.login}@users.noreply.github.com` });
  if (dryRun) {
    const { stdout } = await g.run('show', '--stat', 'HEAD');
    log(`Dry run: committed locally on ${branch} in ${config.workdir}, not pushed.\n${stdout}`);
    return;
  }
  await g.push(branch);
  log(`Pushed ${branch}. The open-pr workflow will open "${result.title}" as Rook and assign it to Ricky.`);
}

async function doReplies({ g, gh, me, models, context, comments }) {
  const branch = `claude/rook-replies-${today}`;
  if (!comments.length) return log('Replies: no new comments.');
  if (await g.remoteBranchExists(branch)) return log(`Replies: ${branch} already exists; skipping.`);
  log(`Replies: ${comments.length} new comment(s). Drafting on ${branch}.`);
  await g.startBranch(branch);

  const issues = new Set(comments.map((c) => c.issue));
  const writable = [/^replies\/\d+-[a-z0-9-]+\.md$/];
  const { tools, state } = makeTools({
    root: config.workdir,
    writable,
    log,
    validate: async () => {
      for (const file of await g.changedFiles()) {
        if (file.status !== '??' && file.status !== 'A') return `${file.path} already existed; write a new file instead of changing it.`;
        const source = readFileSync(join(config.workdir, file.path), 'utf8');
        const issue = Number(source.match(/^---\nissue:\s*(\d+)\s*\n---\n[\s\S]*\S/)?.[1]);
        if (!issues.has(issue)) return `${file.path} needs front matter "issue: <number>" for one of issues ${[...issues].join(', ')}, then a reply.`;
      }
      return null;
    },
  });
  const result = await runAgent({
    models,
    system: context.system,
    prompt: repliesPrompt({ today, comments }),
    tools,
    state,
    maxTurns: config.maxTurns,
    log,
  });
  await finishTask({ g, me, branch, result, models, allowed: writable });
}

async function doPost({ g, gh, me, models, context, comments, stats }) {
  const branch = `claude/rook-post-${thursday}`;
  if (await g.remoteBranchExists(branch)) return log(`Post: ${branch} already exists; skipping.`);
  if (context.posts.some((p) => p.file.startsWith(thursday))) return log(`Post: a post for ${thursday} is already on main; skipping.`);

  // An earlier week's post still waiting for review means no new post this week.
  for (const pr of await gh.all('/{repo}/pulls?state=open')) {
    const files = await gh.all(`/{repo}/pulls/${pr.number}/files`);
    const post = files.find((f) => f.status === 'added' && /^src\/content\/posts\/\d{4}-\d{2}-\d{2}-/.test(f.filename));
    if (!post) continue;
    if (post.filename.startsWith(`src/content/posts/${thursday}-`)) {
      return log(`Post: this week's post is already in PR #${pr.number}; skipping.`);
    }
    log(`Post: PR #${pr.number} (${pr.title}) is still unmerged, so no new post this week.`);
    const marker = `<!-- rook-runner: waiting ${today} -->`;
    const existing = await gh.all(`/{repo}/issues/${pr.number}/comments`);
    if (!dryRun && !existing.some((c) => c.body?.includes(marker))) {
      await gh.request(`/{repo}/issues/${pr.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: `The next post is waiting on this one: merge or close it and I'll write the next one on Monday.\n\n${marker}` }),
      });
    }
    return;
  }

  log(`Post: writing the post for Thursday ${thursday} on ${branch}.`);
  await g.startBranch(branch);
  log('Installing site dependencies (npm ci).');
  await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: config.workdir });

  const postFile = new RegExp(`^src/content/posts/${thursday}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`);
  const writable = [postFile, /^IDEAS\.md$/];
  const { tools, state } = makeTools({
    root: config.workdir,
    writable,
    build: true,
    buildHint: [
      'The post\'s front matter must look like this (the build checks it against src/content.config.ts):',
      '---',
      'title: A clear, specific title',
      'description: One or two sentences on what the reader will get.',
      `pubDate: ${thursday}`,
      'tags: [apis, ai, governance]',
      'social: The Bluesky line, at most 280 characters.',
      '---',
      'Every value is plain text on one line except tags, which is a list in square brackets. Quote a value that contains a colon followed by a space.',
    ].join('\n'),
    log,
    validate: async () => {
      const changed = await g.changedFiles();
      const posts = changed.filter((f) => postFile.test(f.path));
      if (posts.length !== 1) return `Write exactly one post file matching src/content/posts/${thursday}-<slug>.md (found ${posts.length}).`;
      const { field } = frontMatter(readFileSync(join(config.workdir, posts[0].path), 'utf8'));
      if (!field('title')) return 'The post needs a title.';
      if (field('pubDate') !== thursday) return `pubDate must be ${thursday}.`;
      if (field('draft') === 'true') return 'Remove `draft: true` so the post publishes on its date.';
      const social = field('social');
      if (!social) return 'Add a `social` line for the Bluesky announcement.';
      if (social.length > 280) return `The social line is ${social.length} characters; keep it to 280.`;
      return null;
    },
  });
  const result = await runAgent({
    models,
    system: context.system,
    prompt: postPrompt({ today, thursday, posts: context.posts, ideasMd: context.ideasMd, template: context.template, stats, comments }),
    tools,
    state,
    maxTurns: config.maxTurns,
    log,
  });

  // Belt and braces: the runner checks the build itself before anything is pushed.
  if (!result.skip) {
    const build = await run('npm', ['run', 'build'], { cwd: config.workdir, allowFail: true });
    if (build.code !== 0) throw new Error(`The site build fails with Rook's changes:\n${build.output.slice(-3000)}`);
  }
  await finishTask({ g, me, branch, result, models, allowed: writable });
}

// ---------- main ----------

async function main() {
  if (args.check) process.exit((await check()) ? 0 : 1);
  if (!config.githubToken) throw new Error('ROOK_GITHUB_TOKEN is not set. See runner/README.md.');
  const problem = homeProblem();
  if (problem) throw new Error(problem);
  const only = args.only;
  if (only && !['post', 'replies'].includes(only)) throw new Error('--only takes post or replies');

  const lock = join(config.home, 'run.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    try {
      process.kill(pid, 0);
      throw new Error(`Another run (pid ${pid}) is in progress.`);
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  }
  writeFileSync(lock, String(process.pid));
  try {
    log(`Rook's weekly run for ${today}${dryRun ? ' (dry run)' : ''}. Post date: ${thursday}.`);
    const gh = github(config.githubToken, config.repo);
    const me = await gh.request('/user');
    log(`GitHub: acting as ${me.login}.`);
    const g = makeGit(config.workdir, config.githubToken);
    await g.ensureClone(config.repo);
    await g.fetch('main');
    await g.startBranch('rook-runner');

    const models = new Models(config, log);
    if (models.usingLocal) log(`No Anthropic API key; using the local model ${config.localModel}.`);

    // 1. Numbers.
    const stats = await readStats(g);
    log(stats.report ? `Numbers: read the engagement report.${stats.note ? ` ${stats.note}` : ''}` : `Numbers: ${stats.note}.`);

    const read = (file) => readFile(join(config.workdir, file), 'utf8');
    const context = {
      system: systemPrompt({ repo: config.repo, claudeMd: await read('CLAUDE.md'), voiceMd: await read('VOICE.md') }),
      ideasMd: await read('IDEAS.md'),
      template: await read('src/content/posts/_template.md'),
      posts: await readPosts(config.workdir),
    };
    const comments = await newComments(gh, me);

    // 2. Comments, every week. 3. The post. One failing doesn't stop the other.
    const failures = [];
    for (const [name, task] of [['replies', doReplies], ['post', doPost]]) {
      if (only && only !== name) continue;
      try {
        await task({ g, gh, me, models, context, comments, stats });
      } catch (e) {
        failures.push(name);
        log(`${name} failed: ${e.stack || e.message}`);
      }
    }
    log(`Finished. Models used: ${models.describe()}.${failures.length ? ` Failed: ${failures.join(', ')}.` : ''}`);
    if (failures.length) process.exitCode = 1;
  } finally {
    rmSync(lock, { force: true });
  }
}

main().catch((e) => {
  log(`Run failed: ${e.stack || e.message}`);
  process.exit(1);
});
