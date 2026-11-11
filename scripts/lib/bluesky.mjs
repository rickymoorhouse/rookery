// Small Bluesky (AT Protocol) client shared by the scout and the reply poster.

const SERVICE = 'https://bsky.social';

export async function login(identifier, password) {
  const session = await call('com.atproto.server.createSession', { body: { identifier, password } });
  const token = session.accessJwt;
  return {
    did: session.did,
    handle: session.handle,
    get: (method, query) => call(method, { token, query }),
    post: (method, body) => call(method, { token, body }),
  };
}

async function call(method, { token, query, body } = {}) {
  const url = new URL(`/xrpc/${method}`, SERVICE);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
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

/** https://bsky.app link for an at:// post URI. */
export function webUrl(post) {
  return `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`;
}

/** at://did/app.bsky.feed.post/rkey for a https://bsky.app/profile/<handle or did>/post/<rkey> link. */
export async function resolvePostUrl(client, link) {
  if (link.startsWith('at://')) return link;
  const m = link.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (!m) throw new Error(`not a Bluesky post link: ${link}`);
  let [, actor, rkey] = m;
  if (!actor.startsWith('did:')) {
    actor = (await client.get('com.atproto.identity.resolveHandle', { handle: actor })).did;
  }
  return `at://${actor}/app.bsky.feed.post/${rkey}`;
}
