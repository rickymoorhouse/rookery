// Posts newly published Rookery posts to Rook's X account.
//
// Reads <site>/social.json from the live site, so only posts that are actually
// published are announced, and skips any post whose link already appears in
// Rook's recent X posts. That makes it safe to run after every deploy.
//
// The post is the `social` line plus the link; X builds the preview card from
// the page's own metadata, so no image is uploaded.
//
// Env: SITE_URL (the deployed site, with base path), X_API_KEY, X_API_SECRET,
// X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (see lib/x.mjs). Without credentials it
// does nothing.

import { MAX_LENGTH, URL_LENGTH, fit, hasCredentials, login } from './lib/x.mjs';

// Posts older than this are never announced, so turning this on doesn't flood
// the feed with the back catalogue.
const MAX_AGE_DAYS = 7;

if (!hasCredentials()) {
  console.log('X credentials not set; skipping.');
  process.exit(0);
}

const site = new URL(process.env.SITE_URL.endsWith('/') ? process.env.SITE_URL : `${process.env.SITE_URL}/`);
const res = await fetch(new URL('social.json', site));
if (!res.ok) throw new Error(`social.json: ${res.status}`);
const posts = await res.json();

const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const recent = posts.filter((p) => Date.parse(p.pubDate) >= cutoff);
if (recent.length === 0) {
  console.log('No recent posts to announce.');
  process.exit(0);
}

const x = await login();
// Every post is billed, and reads too, so one small page is enough: it only
// has to reach back past the last few announcements.
const { data: timeline = [] } = await x.get(`/users/${x.id}/tweets`, {
  max_results: 20,
  exclude: 'replies,retweets',
  'tweet.fields': 'entities',
});
const announced = new Set(
  timeline.flatMap((t) => t.entities?.urls ?? []).flatMap((u) => [u.expanded_url, u.unwound_url]).filter(Boolean),
);

// Oldest first, so the feed reads in publishing order.
for (const post of recent.reverse()) {
  if (announced.has(post.url)) {
    console.log(`Already announced: ${post.url}`);
    continue;
  }
  // Room for a blank line and the link, which X counts as a flat 23.
  const text = `${fit(post.text, MAX_LENGTH - URL_LENGTH - 2)}\n\n${post.url}`;
  await x.post('/tweets', { text });
  console.log(`Announced: ${post.url}`);
}
