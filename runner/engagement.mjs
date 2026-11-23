#!/usr/bin/env node
// Starts the weekly engagement report workflow now, so the `stats` branch has
// fresh numbers before Rook's Monday run reads them.
//
// The workflow (engagement-report.mjs and bluesky-scout.mjs, committing to the
// `stats` branch) also runs on a Monday GitHub schedule, but GitHub starts
// scheduled runs hours late, so Rook can find last week's numbers. This
// triggers the same workflow by hand from your machine, ahead of Rook. It runs
// on GitHub, so the GoatCounter token and Bluesky app password stay secrets
// there. Running it twice, or alongside the scheduled run, is harmless: each
// run just rewrites the report.
//
// Usage: node engagement.mjs
// Settings: ROOK_GITHUB_TOKEN (needs Actions: write) and ROOK_REPO, as for rook.mjs.

import { dispatchWorkflow } from './lib/dispatch.mjs';

await dispatchWorkflow('engagement.yml', 'engagement');
