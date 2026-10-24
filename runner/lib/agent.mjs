// The agent loop and the tools Rook gets. Rook can read the checkout, write
// only the files the task allows, fetch web pages, and run the site build.
// Git, commits and pull requests stay with the runner, so the model never
// holds a token or runs a shell.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { run } from './proc.mjs';

const MAX_READ = 100_000;
const MAX_FETCH = 15_000;
const MAX_BUILD_OUTPUT = 6000;
// How many times in a row the model may call finish while it can't finish, or
// rebuild without changing anything, before the runner gives up on the task.
const MAX_STUCK = 4;

// The model stopped making progress; the runner ends the task with this message.
export class StuckError extends Error {}

// The Anthropic API's own web tools. The local model uses fetch_url instead.
export const SERVER_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 15 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 25 },
];

function inside(root, path) {
  const full = resolve(root, path ?? '.');
  const rel = relative(root, full);
  if (rel.startsWith('..') || rel.split(sep)[0] === '.git') {
    throw new Error(`${path} is outside the repository`);
  }
  return { full, rel: rel.split(sep).join('/') };
}

function requireString(input, ...keys) {
  for (const key of keys) {
    if (typeof input?.[key] !== 'string') throw new Error(`"${key}" is required and must be a string`);
  }
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|h\d|li|tr|pre|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The useful part of a failed `npm run build`: colours and Astro's telemetry
// notice removed, starting at the first error and stopping before stack traces.
export function buildErrors(output) {
  const lines = output
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\*\*/g, '')
    .split('\n')
    .map((l) => l.trimEnd());
  const start = lines.findIndex((l) => /\berror\b|Error\]|^error/i.test(l));
  const kept = [];
  for (const line of start === -1 ? lines : lines.slice(start)) {
    if (/^\s*(Stack trace:|at\s)/.test(line)) break;
    if (/^\s*(Hint:|Error reference:|See https:|https:\/\/docs\.astro\.build)/.test(line)) continue;
    kept.push(line);
  }
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() || output.trim();
  return text.length > MAX_BUILD_OUTPUT ? `...\n${text.slice(-MAX_BUILD_OUTPUT)}` : text;
}

// writable: regexes for repo-relative paths Rook may write.
// build: whether the task must leave a passing `npm run build` behind.
// prepare: (path, content) => content, to tidy a file before it is written.
// buildHint: extra advice sent back with a failed build, e.g. what the front matter must look like.
// validate: called on finish; returns an error message to send back, or null.
export function makeTools({ root, writable, build = false, buildHint = '', prepare = (path, content) => content, validate = async () => null, log }) {
  // stuck counts finish calls that were refused and rebuilds with nothing changed,
  // since the last write. A weak model can otherwise loop on finish forever.
  const state = { written: new Set(), buildOk: !build, buildError: null, changedSinceBuild: true, stuck: 0, finished: null };

  function refuse(message) {
    state.stuck += 1;
    if (state.stuck >= MAX_STUCK) {
      throw new StuckError(`Gave up after ${state.stuck} attempts in a row without fixing anything. Last problem: ${message}`);
    }
    throw new Error(message);
  }
  const fixIt = () =>
    `The build is failing, so you can't finish yet. Fix the problem below by writing the corrected file in full with write_file, then call run_build again.\n\n${state.buildError}${buildHint ? `\n\n${buildHint}` : ''}`;

  const tools = [
    {
      name: 'list_files',
      description: 'List the files and folders in a directory of the repository. Paths are relative to the repository root.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory, e.g. "src/content/posts". Use "." for the root.' } },
        required: ['path'],
        additionalProperties: false,
      },
      async run(input) {
        requireString(input, 'path');
        const { full } = inside(root, input.path);
        const entries = await readdir(full, { withFileTypes: true });
        return entries
          .filter((e) => !['node_modules', '.git', 'dist', '.astro'].includes(e.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join('\n');
      },
    },
    {
      name: 'read_file',
      description: 'Read a text file from the repository.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      async run(input) {
        requireString(input, 'path');
        const text = await readFile(inside(root, input.path).full, 'utf8');
        return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n[truncated]` : text;
      },
    },
    {
      name: 'write_file',
      description: `Create or replace a file with the full content given. You may only write: ${writable.map((r) => r.source).join(', ')}.`,
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the repository root.' },
          content: { type: 'string', description: 'The complete new content of the file.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      async run(input) {
        requireString(input, 'path', 'content');
        const { full, rel } = inside(root, input.path);
        if (!writable.some((r) => r.test(rel))) throw new Error(`Not allowed to write ${rel} in this task.`);
        await mkdir(dirname(full), { recursive: true });
        const content = prepare(rel, input.content);
        await writeFile(full, content.endsWith('\n') ? content : `${content}\n`);
        state.written.add(rel);
        state.changedSinceBuild = true;
        state.stuck = 0;
        if (build) state.buildOk = false;
        log(`  wrote ${rel}`);
        return `Wrote ${rel} (${input.content.length} characters).`;
      },
    },
    {
      name: 'fetch_url',
      localOnly: true,
      description: 'Fetch a web page and return its text, to read and check sources. Long pages are cut short.',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'An http or https URL.' } },
        required: ['url'],
        additionalProperties: false,
      },
      async run(input) {
        requireString(input, 'url');
        if (!/^https?:\/\//.test(input.url)) throw new Error('Only http and https URLs can be fetched.');
        const res = await fetch(input.url, {
          headers: { 'User-Agent': 'RookeryRunner/0.1 (+https://rookery.api.me.uk)' },
          signal: AbortSignal.timeout(30_000),
        });
        const type = res.headers.get('content-type') ?? '';
        const body = await res.text();
        const text = type.includes('html') ? htmlToText(body) : body;
        const cut = text.length > MAX_FETCH ? `${text.slice(0, MAX_FETCH)}\n[truncated]` : text;
        return `HTTP ${res.status} ${input.url}\n\n${cut}`;
      },
    },
    {
      name: 'finish',
      description:
        'Call once the work is complete. The title and description become the pull request. If there is nothing worth doing, call it with skip set to true and say why in the description.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The pull request title.' },
          description: { type: 'string', description: 'The full pull request description, in Markdown.' },
          skip: { type: 'boolean', description: 'True if there is nothing to submit this time.' },
        },
        required: ['title', 'description'],
        additionalProperties: false,
      },
      async run(input) {
        requireString(input, 'title', 'description');
        if (!input.skip) {
          if (!state.written.size) refuse('Nothing has been written yet. Write the files first, or finish with skip: true.');
          if (!state.buildOk) refuse(state.buildError && !state.changedSinceBuild ? fixIt() : 'Call run_build after your last change and fix any errors before finishing.');
          const problem = await validate(state);
          if (problem) refuse(`${problem} Fix it with write_file, then${build ? ' call run_build and' : ''} finish again.`);
        }
        state.finished = { title: input.title.trim(), description: input.description.trim(), skip: Boolean(input.skip) };
        return 'Done. The runner takes it from here.';
      },
    },
  ];

  if (build) {
    tools.splice(tools.length - 1, 0, {
      name: 'run_build',
      description: 'Run `npm run build` (astro check, then the site build). It must pass before you finish.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        if (!state.buildOk && !state.changedSinceBuild) refuse(`Nothing has changed since the last build failed. ${fixIt()}`);
        const result = await run('npm', ['run', 'build'], { cwd: root, allowFail: true });
        state.buildOk = result.code === 0;
        state.changedSinceBuild = false;
        if (state.buildOk) {
          state.buildError = null;
          log('  build passed');
          return 'Build passed. If you have nothing else to change, call finish.';
        }
        state.buildError = buildErrors(result.output);
        log(`  build failed:\n${state.buildError.split('\n').slice(0, 15).map((l) => `    ${l}`).join('\n')}`);
        return `Build FAILED.\n\n${fixIt()}`;
      },
    });
  }

  return { tools, state };
}

export async function runAgent({ models, system, prompt, tools, state, maxTurns, log }) {
  const messages = [{ role: 'user', content: prompt }];
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const specs = tools.map(({ run, ...spec }) => spec);
  let nudges = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await models.turn({ system, messages, tools: specs, serverTools: SERVER_TOOLS });
    messages.push({ role: 'assistant', content: response.content });

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) log(`  rook: ${block.text.trim().split('\n')[0].slice(0, 200)}`);
      if (block.type === 'server_tool_use') log(`  ${block.name}: ${JSON.stringify(block.input).slice(0, 160)}`);
    }

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason === 'max_tokens') throw new Error('The model ran out of output space mid-turn.');

    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      if (++nudges > 3) throw new Error('The model stopped without calling finish.');
      messages.push({ role: 'user', content: 'Carry on with the task. When it is complete, call the finish tool.' });
      continue;
    }

    const results = [];
    for (const call of calls) {
      log(`  ${call.name}${call.input?.path ? ` ${call.input.path}` : call.input?.url ? ` ${call.input.url}` : ''}`);
      try {
        const tool = byName[call.name];
        if (!tool) throw new Error(`There is no tool called ${call.name}.`);
        const output = await tool.run(call.input ?? {});
        results.push({ type: 'tool_result', tool_use_id: call.id, content: String(output) });
      } catch (error) {
        if (error instanceof StuckError) throw error;
        // run_build logs its own failures; for the rest, show why the call was refused.
        if (call.name !== 'run_build') log(`    refused: ${error.message.split('\n')[0].slice(0, 200)}`);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: `Error: ${error.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
    if (state.finished) return state.finished;
  }
  throw new Error(`No result after ${maxTurns} turns.`);
}
