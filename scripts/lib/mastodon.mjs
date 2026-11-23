// Small Mastodon client shared by the announcer and the reply poster.
//
// Env: MASTODON_INSTANCE (host or URL, e.g. mastodon.social) and
// MASTODON_ACCESS_TOKEN, from an application with the read and write scopes.

const DEFAULT_LIMITS = { max_characters: 500, characters_reserved_per_url: 23 };

export const hasCredentials = (env = process.env) => Boolean(env.MASTODON_INSTANCE && env.MASTODON_ACCESS_TOKEN);

/** The instance as a URL, whether it was given as `host` or `https://host/`. */
const instanceUrl = (value) => new URL(/^https?:\/\//.test(value) ? value : `https://${value}`);

export async function login(env = process.env) {
  const base = instanceUrl(env.MASTODON_INSTANCE);
  const token = env.MASTODON_ACCESS_TOKEN;

  async function call(path, { query, body, headers } = {}) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) {
      const reset = res.headers.get('x-ratelimit-reset');
      const limit = res.status === 429 && reset ? ` (rate limit resets ${reset})` : '';
      throw new Error(`${path}: ${res.status}${limit} ${await res.text()}`);
    }
    return res.json();
  }

  const me = await call('/api/v1/accounts/verify_credentials');
  let limits = DEFAULT_LIMITS;
  try {
    limits = { ...DEFAULT_LIMITS, ...(await call('/api/v2/instance')).configuration.statuses };
  } catch {
    // Older servers lack v2; the usual limits apply.
  }
  return {
    id: me.id,
    acct: me.acct,
    limits,
    get: (path, query) => call(path, { query }),
    post: (path, body, headers) => call(path, { body, headers }),
    /** Posts as the account; `key` makes a retry of the same post a no-op. */
    status: (body, key) => call('/api/v1/statuses', { body, headers: key && { 'Idempotency-Key': key } }),
  };
}

/** Length as Mastodon counts it: links are a flat amount, and @user@host counts as @user. */
export function statusLength(text, { characters_reserved_per_url: url } = DEFAULT_LIMITS) {
  const plain = text
    .replace(/https?:\/\/\S+/g, 'x'.repeat(url))
    .replace(/(^|\s)@(\w+)@[\w.-]+/g, '$1@$2');
  return [...plain].length;
}

/** Trims text at a word boundary so it counts as at most `max`. */
export function fit(text, max, limits) {
  if (statusLength(text, limits) <= max) return text;
  let cut = '';
  for (const ch of text) {
    if (statusLength(`${cut}${ch}…`, limits) > max) break;
    cut += ch;
  }
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
