// Posts newly published Rookery posts to Rook's Bluesky account.
//
// Reads <site>/social.json from the live site, so only posts that are actually
// published are announced, and skips any post whose link already appears in
// Rook's recent Bluesky posts. That makes it safe to run after every deploy.
//
// Env: SITE_URL (the deployed site, with base path), BLUESKY_HANDLE,
// BLUESKY_APP_PASSWORD. Without credentials it does nothing.

const SERVICE = 'https://bsky.social';
// Posts older than this are never announced, so turning this on doesn't flood
// the feed with the back catalogue.
const MAX_AGE_DAYS = 7;

const { SITE_URL, BLUESKY_HANDLE, BLUESKY_APP_PASSWORD } = process.env;

if (!BLUESKY_HANDLE || !BLUESKY_APP_PASSWORD) {
  console.log('Bluesky credentials not set; skipping.');
  process.exit(0);
}

async function xrpc(method, { token, query, body } = {}) {
  const url = new URL(`/xrpc/${method}`, SERVICE);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Bluesky allows 300 graphemes; trim at a word boundary with room to spare.
function fit(text, max = 290) {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join('');
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}

const site = new URL(SITE_URL.endsWith('/') ? SITE_URL : `${SITE_URL}/`);
const res = await fetch(new URL('social.json', site));
if (!res.ok) throw new Error(`social.json: ${res.status}`);
const posts = await res.json();

const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const recent = posts.filter((p) => Date.parse(p.pubDate) >= cutoff);
if (recent.length === 0) {
  console.log('No recent posts to announce.');
  process.exit(0);
}

const session = await xrpc('com.atproto.server.createSession', {
  body: { identifier: BLUESKY_HANDLE, password: BLUESKY_APP_PASSWORD },
});
const feed = await xrpc('app.bsky.feed.getAuthorFeed', {
  token: session.accessJwt,
  query: { actor: session.did, limit: '50', filter: 'posts_no_replies' },
});
const announced = new Set(
  feed.feed.map((item) => item.post.record?.embed?.external?.uri).filter(Boolean),
);

// Oldest first, so the feed reads in publishing order.
for (const post of recent.reverse()) {
  if (announced.has(post.url)) {
    console.log(`Already announced: ${post.url}`);
    continue;
  }
  await xrpc('com.atproto.repo.createRecord', {
    token: session.accessJwt,
    body: {
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: fit(post.text),
        createdAt: new Date().toISOString(),
        langs: ['en-GB'],
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: post.url, title: post.title, description: post.description },
        },
      },
    },
  });
  console.log(`Announced: ${post.url}`);
}
