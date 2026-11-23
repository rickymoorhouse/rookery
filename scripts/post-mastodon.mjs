// Posts approved Mastodon replies as Rook's account.
//
// Rook drafts each reply as replies/mastodon/<yyyy-mm-dd>-<slug>.md in a pull
// request; merging it is the approval. On push to main this posts every reply
// whose parent Rook hasn't already answered, and follows the author when the
// file asks it to.
//
// File format:
//   ---
//   reply_to: https://mastodon.social/@someone/123456789
//   follow: true        # optional: also follow the post's author
//   ---
//   The reply, plain text, within the server's limit (500 characters on
//   mastodon.social). A URL counts as 23. The author is @mentioned for you if
//   the text doesn't already do so.
//
// The post can live on any server; the instance looks it up first.
//
// Env: MASTODON_INSTANCE, MASTODON_ACCESS_TOKEN (see lib/mastodon.mjs).

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasCredentials, login, statusLength } from './lib/mastodon.mjs';

const DIR = 'replies/mastodon';

if (!hasCredentials()) {
  console.log('Mastodon credentials not set; skipping.');
  process.exit(0);
}

function parse(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const front = match?.[1] ?? '';
  const replyTo = front.match(/^reply_to:\s*"?([^"\s]+)"?\s*$/m)?.[1];
  const follow = /^follow:\s*true\s*$/m.test(front);
  const text = match?.[2].trim();
  if (!replyTo || !text) throw new Error(`${file}: needs front matter with "reply_to: <post link>" and a body`);
  if (!/^https?:\/\//.test(replyTo)) throw new Error(`${file}: reply_to must be a link to a Mastodon post`);
  return { replyTo, follow, text };
}

let files;
try {
  files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
} catch {
  files = [];
}
if (files.length === 0) {
  console.log('No Mastodon replies.');
  process.exit(0);
}

// Read every file first so a malformed one fails before anything is posted.
const replies = [];
for (const file of files) replies.push({ file, ...parse(await readFile(join(DIR, file), 'utf8'), file) });

const mastodon = await login();
for (const { file, text } of replies) {
  if (statusLength(text, mastodon.limits) > mastodon.limits.max_characters) {
    throw new Error(`${file}: reply is over ${mastodon.limits.max_characters} characters`);
  }
}

// Posts Rook has already replied to, so re-runs never post twice. The ids are
// this server's, which is what the lookup below returns for any post.
const answered = new Set();
let maxId;
for (let page = 0; page < 5; page++) {
  const batch = await mastodon.get(`/api/v1/accounts/${mastodon.id}/statuses`, {
    limit: 40,
    exclude_reblogs: true,
    ...(maxId && { max_id: maxId }),
  });
  for (const s of batch) if (s.in_reply_to_id) answered.add(s.in_reply_to_id);
  if (batch.length < 40) break;
  maxId = batch.at(-1).id;
}

let failed = false;
for (const { file, replyTo, follow, text } of replies) {
  try {
    const { statuses } = await mastodon.get('/api/v2/search', { q: replyTo, type: 'statuses', resolve: true, limit: 1 });
    const parent = statuses[0];
    if (!parent) {
      console.log(`${file}: the post it replies to can't be found; skipped.`);
      continue;
    }
    if (answered.has(parent.id)) continue;

    // Mastodon doesn't add the mention itself, and without it the author isn't told.
    const handle = `@${parent.account.acct}`;
    const status = text.includes(handle) ? text : `${handle} ${text}`;
    if (statusLength(status, mastodon.limits) > mastodon.limits.max_characters) {
      throw new Error(`reply plus ${handle} is over ${mastodon.limits.max_characters} characters`);
    }
    await mastodon.status(
      { status, in_reply_to_id: parent.id, visibility: parent.visibility === 'public' ? 'public' : 'unlisted', language: 'en' },
      createHash('sha256').update(`reply:${file}`).digest('hex'),
    );
    answered.add(parent.id);
    console.log(`Replied to ${replyTo} (${file})`);

    if (follow && parent.account.id !== mastodon.id) {
      const [rel] = await mastodon.get('/api/v1/accounts/relationships', { 'id[]': parent.account.id });
      if (!rel?.following && !rel?.requested) {
        await mastodon.post(`/api/v1/accounts/${parent.account.id}/follow`, {});
        console.log(`Followed ${handle}`);
      }
    }
  } catch (e) {
    failed = true;
    console.error(`${file}: ${e.message}`);
  }
}
if (failed) process.exitCode = 1;
