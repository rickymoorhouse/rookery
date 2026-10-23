// Works out when the next scheduled post goes live, for publish-scheduled.yml.
//
// A post merged ahead of its pubDate only appears when the site is rebuilt on
// or after that date. GitHub's cron starts hours late, so instead a workflow
// waits in a job until the post is due and then starts the deploy itself. A
// hosted job can run for at most 6 hours, so a longer wait is done in steps:
// the job waits up to MAX_WAIT and starts a fresh copy of itself.
//
// Posts go live at PUBLISH_HOUR on their pubDate, UK time.
//
// Prints GitHub Actions outputs: `wait` (seconds) and `then` (`deploy`,
// `reschedule` or `none`). With POSTS_DIR and NOW (ISO time) for testing.

import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLISH_HOUR = 6;
const TIME_ZONE = 'Europe/London';
// Under the 6 hour job limit, with room for setup and the deploy dispatch.
const MAX_WAIT = 5.5 * 60 * 60;

const postsDir = process.env.POSTS_DIR ?? 'src/content/posts';
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();

/** PUBLISH_HOUR on the given yyyy-mm-dd, in TIME_ZONE, as a Date. */
export function publishTime(day) {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, PUBLISH_HOUR);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(guess),
  );
  return new Date(guess - (hour - PUBLISH_HOUR) * 60 * 60 * 1000);
}

function frontMatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const field = (name) => block.match(new RegExp(`^${name}:\\s*['"]?([^'"\\n]+)`, 'm'))?.[1]?.trim();
  return { pubDate: field('pubDate'), draft: field('draft') === 'true' };
}

const due = readdirSync(postsDir)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map((f) => frontMatter(readFileSync(join(postsDir, f), 'utf8')))
  .filter((p) => !p.draft && p.pubDate)
  .map((p) => publishTime(p.pubDate.slice(0, 10)))
  .filter((t) => t > now)
  .sort((a, b) => a - b);

let wait = 0;
let then = 'none';
if (due.length > 0) {
  const seconds = Math.ceil((due[0] - now) / 1000);
  wait = Math.min(seconds, MAX_WAIT);
  then = seconds <= MAX_WAIT ? 'deploy' : 'reschedule';
  console.log(`Next post goes live at ${due[0].toISOString()}; waiting ${wait}s, then ${then}.`);
} else {
  console.log('No scheduled posts.');
}

const out = `wait=${wait}\nthen=${then}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
else process.stdout.write(out);
