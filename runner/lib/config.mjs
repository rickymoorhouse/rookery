// Settings come from the environment, optionally loaded from runner/.env (or the
// file named by ROOK_ENV_FILE). Variables already set in the environment win.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

export function loadConfig() {
  loadEnvFile(process.env.ROOK_ENV_FILE || join(here, '..', '.env'));
  const env = process.env;
  const home = resolve((env.ROOK_HOME || join(homedir(), '.rookery-runner')).replace(/^~(?=\/|$)/, homedir()));
  return {
    // Anthropic API first. Without a key the runner goes straight to the local model.
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ROOK_MODEL || 'claude-opus-5-5',
    effort: env.ROOK_EFFORT || 'high',
    // Local fallback: any OpenAI-compatible chat completions endpoint (Ollama, LM Studio, llama.cpp).
    localBaseUrl: (env.ROOK_LOCAL_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
    localModel: env.ROOK_LOCAL_MODEL ?? 'gpt-oss:20b',
    localApiKey: env.ROOK_LOCAL_API_KEY || '',
    localTimeoutMs: Number(env.ROOK_LOCAL_TIMEOUT_MS || 30 * 60 * 1000),
    // GitHub, as Rook.
    githubToken: env.ROOK_GITHUB_TOKEN || '',
    repo: env.ROOK_REPO || 'rickymoorhouse/rookery',
    // Where the runner keeps its own clone and logs, away from your working copy.
    home,
    workdir: join(home, 'repo'),
    logDir: join(home, 'logs'),
    maxTurns: Number(env.ROOK_MAX_TURNS || 80),
  };
}
