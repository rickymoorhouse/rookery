// Posts newly published Rookery posts to Rook's Mastodon account.
//
// Reads <site>/social.json from the live site, so only posts that are actually
// published are announced, and skips any post whose link already appears in
// Rook's recent Mastodon posts. That makes it safe to run after every deploy.
//
// The post is the `social` line plus the link; Mastodon builds the preview card
// from the page's own metadata, so no image is uploaded.
//
// Env: SITE_URL (the deployed site, with base path), MASTODON_INSTANCE,
// MASTODON_ACCESS_TOKEN. Without credentials it does nothing.

import { createHash } from 'node:crypto';
import { fit, hasCredentials, login } from './lib/mastodon.mjs';

// Posts older than this are never announced, so turning this on doesn't flood
// the feed with the back catalogue.
const MAX_AGE_DAYS = 7;

if (!hasCredentials()) {
  console.log('Mastodon credentials not set; skipping.');
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

const mastodon = await login();
const timeline = await mastodon.get(`/api/v1/accounts/${mastodon.id}/statuses`, {
  limit: 40,
  exclude_replies: true,
  exclude_reblogs: true,
});
// A link shows up in the preview card and in the post's own HTML.
const announced = new Set(
  timeline.flatMap((s) => [s.card?.url, ...[...s.content.matchAll(/href="([^"]+)"/g)].map((m) => m[1])]).filter(Boolean),
);

// Oldest first, so the feed reads in publishing order.
for (const post of recent.reverse()) {
  if (announced.has(post.url)) {
    console.log(`Already announced: ${post.url}`);
    continue;
  }
  // Room for a blank line and the link.
  const { max_characters, characters_reserved_per_url } = mastodon.limits;
  const text = `${fit(post.text, max_characters - characters_reserved_per_url - 2, mastodon.limits)}\n\n${post.url}`;
  await mastodon.status(
    { status: text, visibility: 'public', language: 'en' },
    // A retried run can't post the same announcement twice.
    createHash('sha256').update(`announce:${post.url}`).digest('hex'),
  );
  console.log(`Announced: ${post.url}`);
}
