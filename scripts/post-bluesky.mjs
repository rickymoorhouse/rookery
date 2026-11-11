// Posts approved Bluesky replies as Rook's account.
//
// Rook drafts each reply as replies/bluesky/<yyyy-mm-dd>-<slug>.md in a pull
// request; merging it is the approval. On push to main this posts every reply
// whose parent Rook hasn't already answered, and follows the author when the
// file asks it to.
//
// File format:
//   ---
//   reply_to: https://bsky.app/profile/<handle>/post/<id>
//   follow: true        # optional: also follow the post's author
//   ---
//   The reply, plain text, at most 300 characters. A URL in it becomes a link.
//
// Env: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { login, resolvePostUrl } from './lib/bluesky.mjs';

const { BLUESKY_HANDLE, BLUESKY_APP_PASSWORD } = process.env;
const DIR = 'replies/bluesky';

if (!BLUESKY_HANDLE || !BLUESKY_APP_PASSWORD) {
  console.log('Bluesky credentials not set; skipping.');
  process.exit(0);
}

function parse(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const front = match?.[1] ?? '';
  const replyTo = front.match(/^reply_to:\s*"?([^"\s]+)"?\s*$/m)?.[1];
  const follow = /^follow:\s*true\s*$/m.test(front);
  const text = match?.[2].trim();
  if (!replyTo || !text) throw new Error(`${file}: needs front matter with "reply_to: <post link>" and a body`);
  if ([...text].length > 300) throw new Error(`${file}: reply is over 300 characters`);
  return { replyTo, follow, text };
}

// Turns URLs in the text into link facets, which Bluesky needs to make them clickable.
function facets(text) {
  const bytes = new TextEncoder();
  const out = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)]+[^\s).,;:!?]/g)) {
    const byteStart = bytes.encode(text.slice(0, m.index)).length;
    out.push({
      index: { byteStart, byteEnd: byteStart + bytes.encode(m[0]).length },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  return out;
}

let files;
try {
  files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
} catch {
  files = [];
}
if (files.length === 0) {
  console.log('No Bluesky replies.');
  process.exit(0);
}

const bsky = await login(BLUESKY_HANDLE, BLUESKY_APP_PASSWORD);

// Posts Rook has already replied to, so re-runs never post twice.
const { feed } = await bsky.get('app.bsky.feed.getAuthorFeed', {
  actor: bsky.did,
  filter: 'posts_with_replies',
  limit: 100,
});
const answered = new Set(feed.map((i) => i.post.record?.reply?.parent?.uri).filter(Boolean));
const { follows } = await bsky.get('app.bsky.graph.getFollows', { actor: bsky.did, limit: 100 });
const following = new Set(follows.map((f) => f.did));

for (const file of files) {
  const { replyTo, follow, text } = parse(await readFile(join(DIR, file), 'utf8'), file);
  const parentUri = await resolvePostUrl(bsky, replyTo);
  if (answered.has(parentUri)) continue;

  const { posts } = await bsky.get('app.bsky.feed.getPosts', { uris: parentUri });
  const parent = posts?.[0];
  if (!parent) {
    console.log(`${file}: the post it replies to is gone; skipped.`);
    continue;
  }
  const root = parent.record?.reply?.root ?? { uri: parent.uri, cid: parent.cid };
  await bsky.post('com.atproto.repo.createRecord', {
    repo: bsky.did,
    collection: 'app.bsky.feed.post',
    record: {
      $type: 'app.bsky.feed.post',
      text,
      facets: facets(text),
      langs: ['en-GB'],
      createdAt: new Date().toISOString(),
      reply: { root, parent: { uri: parent.uri, cid: parent.cid } },
    },
  });
  console.log(`Replied to ${replyTo} (${file})`);

  if (follow && !following.has(parent.author.did) && parent.author.did !== bsky.did) {
    await bsky.post('com.atproto.repo.createRecord', {
      repo: bsky.did,
      collection: 'app.bsky.graph.follow',
      record: { $type: 'app.bsky.graph.follow', subject: parent.author.did, createdAt: new Date().toISOString() },
    });
    following.add(parent.author.did);
    console.log(`Followed @${parent.author.handle}`);
  }
}
