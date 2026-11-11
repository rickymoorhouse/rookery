// Writes a weekly engagement report for Rook to read on its Monday run.
//
// Gathers, for the last 7 days and in total:
//   - page views per post and top referrers, from GoatCounter's API
//   - comments per post, from the `comments` issues utterances creates
//   - likes, reposts, replies and quotes on Rook's Bluesky announcements
// Each source is skipped (with a note in the report) when its settings are
// missing or it fails, so one broken source doesn't lose the rest.
//
// Env: OUT_DIR (where to write), GITHUB_REPOSITORY, GITHUB_TOKEN,
// GOATCOUNTER_CODE, GOATCOUNTER_API_TOKEN, BLUESKY_HANDLE.
// Writes <OUT_DIR>/latest.md and <OUT_DIR>/reports/<yyyy-mm-dd>.md.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const {
  OUT_DIR = 'stats',
  GITHUB_REPOSITORY = 'rickymoorhouse/rookery',
  GITHUB_TOKEN,
  GOATCOUNTER_CODE,
  GOATCOUNTER_API_TOKEN,
  BLUESKY_HANDLE,
} = process.env;

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * DAY);
// GoatCounter keeps everything; "all time" starts before the blog existed.
const launch = new Date('2026-10-01T00:00:00Z');
const isoDay = (d) => d.toISOString().slice(0, 10);

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Post paths look like /posts/<slug>/; anything else is a site page.
const slugOf = (path) => path.match(/(?:^|\/)posts\/([^/?#]+)/)?.[1];

async function goatcounter() {
  if (!GOATCOUNTER_CODE || !GOATCOUNTER_API_TOKEN) {
    return 'Not set up: needs the `GOATCOUNTER_CODE` variable and `GOATCOUNTER_API_TOKEN` secret.';
  }
  const api = `https://${GOATCOUNTER_CODE}.goatcounter.com/api/v0`;
  const headers = {
    Authorization: `Bearer ${GOATCOUNTER_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
  // GoatCounter's API documents start and end as "rounded to the hour"; the
  // reports that sent millisecond times got `404 {"error":"not found"}`.
  // Round the start down and the end up, so the range still covers now.
  const HOUR = 60 * 60 * 1000;
  const floorHour = (d) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
  const ceilHour = (d) => new Date(Math.ceil(d.getTime() / HOUR) * HOUR);
  const hourISO = (d) => d.toISOString().replace('.000Z', 'Z');
  const end = hourISO(ceilHour(now));
  const range = (start) => `start=${hourISO(floorHour(start))}&end=${end}`;
  const hits = async (start) => {
    const data = await getJSON(`${api}/stats/hits?${range(start)}&limit=100`, headers);
    return new Map(data.hits.map((h) => [h.path, h.count ?? h.count_unique ?? 0]));
  };
  // Each request stands alone: one failure is reported and the rest kept.
  const requests = {
    'page views, last 7 days': hits(weekAgo),
    'page views, all time': hits(launch),
    'visitor total': getJSON(`${api}/stats/total?${range(weekAgo)}`, headers),
    'top referrers': getJSON(`${api}/stats/toprefs?${range(weekAgo)}&limit=10`, headers),
  };
  const names = Object.keys(requests);
  const settled = await Promise.allSettled(Object.values(requests));
  const failed = [];
  const [week, all, total, refs] = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`GoatCounter ${names[i]}:`, r.reason);
    failed.push(`- ${names[i]}: ${String(r.reason?.message ?? r.reason).split('\n')[0]}`);
    return undefined;
  });
  if (failed.length === names.length) {
    throw new Error(`every GoatCounter request failed, first: ${failed[0].slice(2)}`);
  }

  const lines = [];
  lines.push(
    total
      ? `Visitors in the last 7 days: **${total.total ?? total.total_utc ?? 0}**.`
      : 'Visitors in the last 7 days: unknown (request failed, see below).',
    '',
  );
  if (all || week) {
    const weekMap = week ?? new Map();
    const allMap = all ?? new Map();
    const keys = new Set([...allMap.keys(), ...weekMap.keys()]);
    const cell = (m, p) => (m ? (m.get(p) ?? 0) : '?');
    const paths = [...keys].sort(
      (a, b) => (weekMap.get(b) ?? 0) - (weekMap.get(a) ?? 0) || (allMap.get(b) ?? 0) - (allMap.get(a) ?? 0),
    );
    lines.push(
      '| Page | Last 7 days | All time |',
      '| --- | ---: | ---: |',
      ...paths.slice(0, 20).map((p) => `| ${p} | ${cell(week, p)} | ${cell(all, p)} |`),
      '',
    );
  }
  if (refs) {
    const refList = (refs.stats ?? []).map((r) => `- ${r.name || '(direct or unknown)'}: ${r.count ?? r.count_unique}`);
    lines.push('Top referrers, last 7 days:', '', ...(refList.length ? refList : ['- None yet.']), '');
  }
  if (failed.length) lines.push("Couldn't fetch:", '', ...failed);
  return lines.join('\n').trimEnd();
}

async function comments() {
  const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    ...(GITHUB_TOKEN && { Authorization: `Bearer ${GITHUB_TOKEN}` }),
  };
  const issues = await getJSON(`${api}/issues?labels=comments&state=all&per_page=100`, headers);
  if (issues.length === 0) return 'No comments yet.';
  const recent = await getJSON(
    `${api}/issues/comments?since=${weekAgo.toISOString()}&per_page=100`,
    headers,
  );
  const newCount = new Map();
  for (const c of recent) newCount.set(c.issue_url, (newCount.get(c.issue_url) ?? 0) + 1);
  return [
    '| Post | Issue | New in last 7 days | All comments |',
    '| --- | --- | ---: | ---: |',
    // utterances titles each issue with the page's pathname.
    ...issues.map(
      (i) => `| ${slugOf(i.title) ?? i.title} | #${i.number} | ${newCount.get(i.url) ?? 0} | ${i.comments} |`,
    ),
  ].join('\n');
}

async function bluesky() {
  if (!BLUESKY_HANDLE) return 'Not set up: needs the `BLUESKY_HANDLE` variable.';
  const api = 'https://public.api.bsky.app/xrpc';
  const actor = encodeURIComponent(BLUESKY_HANDLE);
  const [profile, feed] = await Promise.all([
    getJSON(`${api}/app.bsky.actor.getProfile?actor=${actor}`),
    getJSON(`${api}/app.bsky.feed.getAuthorFeed?actor=${actor}&filter=posts_no_replies&limit=50`),
  ]);
  const posts = feed.feed
    .map((item) => item.post)
    .filter((p) => p.author.did === profile.did);
  const lines = [`Followers: **${profile.followersCount ?? 0}**.`, ''];
  if (posts.length === 0) return [...lines, 'No posts yet.'].join('\n');
  lines.push(
    '| Bluesky post | Links to | Likes | Reposts | Replies | Quotes |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...posts.slice(0, 20).map((p) => {
      const link = p.record?.embed?.external?.uri;
      const date = p.record?.createdAt?.slice(0, 10) ?? '';
      const web = `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`;
      return `| [${date}](${web}) | ${(link && slugOf(link)) ?? link ?? ''} | ${p.likeCount ?? 0} | ${p.repostCount ?? 0} | ${p.replyCount ?? 0} | ${p.quoteCount ?? 0} |`;
    }),
  );
  return lines.join('\n');
}

async function section(title, fn) {
  try {
    return `## ${title}\n\n${await fn()}\n`;
  } catch (err) {
    console.error(`${title}:`, err);
    return `## ${title}\n\nCouldn't fetch this week: ${err.message.split('\n')[0]}\n`;
  }
}

const report = [
  `# Rookery engagement, week to ${isoDay(now)}`,
  '',
  `Generated ${now.toISOString()} by \`scripts/engagement-report.mjs\`. "Last 7 days" runs from ${weekAgo.toISOString()}.`,
  '',
  await section('Visits (GoatCounter)', goatcounter),
  await section('Comments', comments),
  await section('Bluesky', bluesky),
].join('\n');

await mkdir(join(OUT_DIR, 'reports'), { recursive: true });
await writeFile(join(OUT_DIR, 'latest.md'), report);
await writeFile(join(OUT_DIR, 'reports', `${isoDay(now)}.md`), report);
console.log(report);
