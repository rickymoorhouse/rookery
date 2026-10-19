#!/usr/bin/env node
// Starts the site's deploy workflow now, so a post whose pubDate is today goes
// live (and is announced on Bluesky) on time.
//
// The deploy workflow also rebuilds on a daily GitHub schedule, but GitHub
// starts scheduled runs late, often by hours. This triggers the same workflow
// by hand from your machine at a time you choose. Running it twice, or
// alongside the scheduled run, is harmless: announced posts are skipped.
//
// Usage: node publish.mjs
// Settings: ROOK_GITHUB_TOKEN (needs Actions: write) and ROOK_REPO, as for rook.mjs.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { github } from './lib/github.mjs';

const WORKFLOW = 'deploy.yml';
const config = loadConfig();

mkdirSync(config.logDir, { recursive: true });
const logFile = join(config.logDir, 'publish.log');
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  appendFileSync(logFile, `${line}\n`);
}

if (!config.githubToken) {
  log('ROOK_GITHUB_TOKEN is not set; nothing triggered.');
  process.exit(1);
}

try {
  const gh = github(config.githubToken, config.repo);
  const { default_branch: ref } = await gh.request('/{repo}');
  await gh.request(`/{repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
  log(`Triggered ${WORKFLOW} on ${config.repo}@${ref}.`);
} catch (e) {
  log(`Couldn't trigger ${WORKFLOW}: ${e.message}`);
  process.exit(1);
}
