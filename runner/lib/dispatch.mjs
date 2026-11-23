// Starts a GitHub Actions workflow by hand on the repo's default branch and
// logs the outcome to <logDir>/<logName>.log. Shared by publish.mjs and
// engagement.mjs. Exits the process with 1 if it can't.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { github } from './github.mjs';

export async function dispatchWorkflow(workflow, logName) {
  const config = loadConfig();

  mkdirSync(config.logDir, { recursive: true });
  const logFile = join(config.logDir, `${logName}.log`);
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
    await gh.request(`/{repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref }),
    });
    log(`Triggered ${workflow} on ${config.repo}@${ref}.`);
  } catch (e) {
    log(`Couldn't trigger ${workflow}: ${e.message}`);
    process.exit(1);
  }
}
