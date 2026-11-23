// Posts approved X replies as Rook's account.
//
// Rook drafts each reply as replies/x/<yyyy-mm-dd>-<slug>.md in a pull request;
// merging it is the approval. On push to main this posts every reply whose
// parent Rook hasn't already answered, and follows the author when the file
// asks it to.
//
// File format:
//   ---
//   reply_to: https://x.com/<handle>/status/<id>
//   follow: true        # optional: also follow the post's author
//   ---
//   The reply, plain text, at most 280 characters. A URL counts as 23.
//
// X only accepts an API reply when the person being answered mentioned Rook or
// quoted one of its posts. Any other reply is refused with a 403; that is
// reported and the rest still go out.
//
// Env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (see lib/x.mjs).

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_LENGTH, hasCredentials, login, statusId, weightedLength } from './lib/x.mjs';

const DIR = 'replies/x';

if (!hasCredentials()) {
  console.log('X credentials not set; skipping.');
  process.exit(0);
}

function parse(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const front = match?.[1] ?? '';
  const replyTo = front.match(/^reply_to:\s*"?([^"\s]+)"?\s*$/m)?.[1];
  const follow = /^follow:\s*true\s*$/m.test(front);
  const text = match?.[2].trim();
  if (!replyTo || !text) throw new Error(`${file}: needs front matter with "reply_to: <post link>" and a body`);
  if (weightedLength(text) > MAX_LENGTH) throw new Error(`${file}: reply is over ${MAX_LENGTH} characters`);
  return { replyTo, follow, text, parentId: statusId(replyTo) };
}

let files;
try {
  files = (await readdir(DIR)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
} catch {
  files = [];
}
if (files.length === 0) {
  console.log('No X replies.');
  process.exit(0);
}

// Read every file first so a malformed one fails before anything is posted.
const replies = [];
for (const file of files) replies.push({ file, ...parse(await readFile(join(DIR, file), 'utf8'), file) });

const x = await login();

// Posts Rook has already replied to, so re-runs never post twice.
const { data: timeline = [] } = await x.get(`/users/${x.id}/tweets`, {
  max_results: 100,
  'tweet.fields': 'referenced_tweets',
});
const answered = new Set(
  timeline.flatMap((t) => t.referenced_tweets ?? []).filter((r) => r.type === 'replied_to').map((r) => r.id),
);
let following;

let failed = false;
for (const { file, replyTo, follow, text, parentId } of replies) {
  if (answered.has(parentId)) continue;
  try {
    const { data: parent } = await x.get(`/tweets/${parentId}`, { 'tweet.fields': 'author_id' });
    if (!parent) {
      console.log(`${file}: the post it replies to is gone; skipped.`);
      continue;
    }
    await x.post('/tweets', { text, reply: { in_reply_to_tweet_id: parentId } });
    answered.add(parentId);
    console.log(`Replied to ${replyTo} (${file})`);

    if (follow && parent.author_id !== x.id) {
      following ??= new Set(
        ((await x.get(`/users/${x.id}/following`, { max_results: 1000 })).data ?? []).map((u) => u.id),
      );
      if (!following.has(parent.author_id)) {
        await x.post(`/users/${x.id}/following`, { target_user_id: parent.author_id });
        following.add(parent.author_id);
        console.log(`Followed ${parent.author_id}`);
      }
    }
  } catch (e) {
    failed = true;
    console.error(`${file}: ${e.message}`);
  }
}
if (failed) process.exitCode = 1;
