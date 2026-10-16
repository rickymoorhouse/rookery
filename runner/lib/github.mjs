// A small GitHub REST client, acting as Rook through ROOK_GITHUB_TOKEN.

// ROOK_GITHUB_API points it somewhere else, for testing.
const API = process.env.ROOK_GITHUB_API || 'https://api.github.com';

export function github(token, repo) {
  async function request(path, init = {}) {
    const url = path.startsWith('https://') ? path : `${API}${path.replace('{repo}', `repos/${repo}`)}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'rookery-runner',
        ...(init.body && { 'Content-Type': 'application/json' }),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${url}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? null : res.json();
  }

  // Follows `page` until a short page comes back.
  async function all(path) {
    const items = [];
    for (let page = 1; page < 50; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = await request(`${path}${sep}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) break;
    }
    return items;
  }

  return { request, all };
}
