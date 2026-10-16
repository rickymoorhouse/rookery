// Git in the runner's own clone. The token is passed through git's environment
// config, so it never lands in .git/config, the process list or a log.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { run } from './proc.mjs';

export function git(workdir, token) {
  const env = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    GIT_TERMINAL_PROMPT: '0',
  };
  const g = (...args) => run('git', args, { cwd: workdir, env, redact: [token] });

  return {
    run: g,
    async ensureClone(repo) {
      // ROOK_GIT_URL points at another remote, for testing.
      const url = process.env.ROOK_GIT_URL || `https://github.com/${repo}.git`;
      if (!existsSync(`${workdir}/.git`)) {
        await mkdir(dirname(workdir), { recursive: true });
        await run('git', ['clone', url, workdir], { env, redact: [token] });
      }
      await g('remote', 'set-url', 'origin', url);
    },
    async fetch(...refs) {
      await g('fetch', '--prune', 'origin', ...refs);
    },
    async remoteBranchExists(branch) {
      const { stdout } = await g('ls-remote', '--heads', 'origin', branch);
      return stdout.length > 0;
    },
    // Fresh branch from origin/main, discarding anything left from an earlier run.
    async startBranch(branch) {
      await g('reset', '--hard');
      await g('clean', '-fd');
      await g('checkout', '-B', branch, 'origin/main');
    },
    async changedFiles() {
      const { stdout } = await g('status', '--porcelain', '--untracked-files=all');
      return stdout ? stdout.split('\n').map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) })) : [];
    },
    async commit(message, author) {
      const file = join(workdir, '.git', 'ROOK_COMMIT_MSG');
      await writeFile(file, message);
      await g('add', '-A');
      await g('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-q', '-F', file);
    },
    async push(branch) {
      await g('push', '-u', 'origin', `HEAD:refs/heads/${branch}`);
    },
    async show(ref) {
      const result = await g('show', ref).catch(() => null);
      return result?.stdout ?? null;
    },
  };
}
