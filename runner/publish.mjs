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

import { dispatchWorkflow } from './lib/dispatch.mjs';

await dispatchWorkflow('deploy.yml', 'publish');
