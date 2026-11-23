// Small X (Twitter) API v2 client shared by the announcer, the reply poster and
// the credential check.
//
// Requests are signed with OAuth 1.0a, using the four static keys from the app's
// page in the X developer portal. Nothing expires or rotates, so there is no
// token to refresh or store. The Access Token must be generated with Read and
// Write permission, and regenerated after changing it.
//
// Env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET.

import { createHmac, randomBytes } from 'node:crypto';

const API = 'https://api.x.com/2';
export const MAX_LENGTH = 280;
// X counts every URL as 23 characters, whatever its length.
export const URL_LENGTH = 23;

export const hasCredentials = (env = process.env) =>
  Boolean(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET);

// RFC 3986 percent-encoding, which OAuth requires (encodeURIComponent leaves !'()* alone).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The Authorization header for one request. `query` is the URL's query string
 * as an object; a JSON body is not part of the signature.
 */
export function oauthHeader({ method, url, query = {}, env = process.env, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const params = Object.entries({ ...query, ...oauth })
    .map(([k, v]) => [enc(k), enc(String(v))])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), enc(url), enc(params)].join('&');
  const key = `${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_TOKEN_SECRET)}`;
  oauth.oauth_signature = createHmac('sha1', key).update(base).digest('base64');
  return `OAuth ${Object.entries(oauth)
    .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
    .join(', ')}`;
}

async function request(path, { query = {}, body } = {}) {
  const method = body ? 'POST' : 'GET';
  const url = `${API}${path}`;
  const target = new URL(url);
  for (const [k, v] of Object.entries(query)) target.searchParams.set(k, String(v));
  const res = await fetch(target, {
    method,
    headers: {
      Authorization: oauthHeader({ method, url, query }),
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) {
    const reset = res.headers.get('x-rate-limit-reset');
    const limit = res.status === 429 && reset ? ` (rate limit resets ${new Date(reset * 1000).toISOString()})` : '';
    throw new Error(`${path}: ${res.status}${limit} ${await res.text()}`);
  }
  return res.json();
}

/** A client for the account the Access Token belongs to. */
export async function login() {
  const { data: me } = await request('/users/me');
  return {
    id: me.id,
    username: me.username,
    get: (path, query) => request(path, { query }),
    post: (path, body) => request(path, { body }),
  };
}

/** Length as X counts it: links are a flat 23, and emoji and CJK count double. */
export function weightedLength(text) {
  let total = 0;
  let rest = text;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    total += URL_LENGTH;
    rest = rest.replace(m[0], '');
  }
  for (const ch of rest) total += ch.codePointAt(0) > 0x10ff ? 2 : 1;
  return total;
}

/** Trims text at a word boundary so it weighs at most `max`. */
export function fit(text, max) {
  if (weightedLength(text) <= max) return text;
  let cut = '';
  for (const ch of text) {
    if (weightedLength(`${cut}${ch}…`) > max) break;
    cut += ch;
  }
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The numeric post id from an x.com or twitter.com status link. */
export function statusId(link) {
  const m = link.match(/(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status\/(\d+)/);
  if (!m) throw new Error(`not an X post link: ${link}`);
  return m[1];
}
