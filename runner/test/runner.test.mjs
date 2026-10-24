import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { buildErrors, htmlToText, makeTools, runAgent, StuckError } from '../lib/agent.mjs';
import { fromOpenAI, Models, toOpenAI } from '../lib/models.mjs';
import { enclosingProject } from '../lib/config.mjs';
import { quoteFrontMatter } from '../lib/frontmatter.mjs';

// A stand-in for an OpenAI-compatible server (Ollama) that plays back scripted replies.
async function fakeServer(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : null;
    requests.push({ url: req.url, body: parsed });
    const [status, payload] = handler(req.url, parsed, requests.length);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

const toolCall = (id, name, args) => ({
  choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const baseConfig = { model: 'claude-opus-5-5', effort: 'high', localModel: 'test-model', localApiKey: '', localTimeoutMs: 10_000 };

test('converts a conversation to the OpenAI format and back', () => {
  const messages = [
    { role: 'user', content: 'Write the post.' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'text', text: 'Reading first.' },
        { type: 'server_tool_use', id: 'srv', name: 'web_search', input: {} },
        { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'IDEAS.md' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '# Ideas' }] },
  ];
  assert.deepEqual(toOpenAI('sys', messages), [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'Write the post.' },
    { role: 'assistant', content: 'Reading first.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"IDEAS.md"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: '# Ideas' },
  ]);

  const turn = fromOpenAI({ choices: [{ finish_reason: 'stop', message: { content: '<think>hmm</think>All done.' } }] });
  assert.deepEqual(turn, { content: [{ type: 'text', text: 'All done.' }], stop_reason: 'end_turn' });
  assert.equal(fromOpenAI(toolCall('c1', 'finish', { title: 'x' })).stop_reason, 'tool_use');
});

test('falls back to the local model when the Anthropic API fails', async () => {
  const anthropic = await fakeServer(() => [400, { type: 'error', error: { type: 'invalid_request_error', message: 'nope' } }]);
  const local = await fakeServer(() => [200, { choices: [{ finish_reason: 'stop', message: { content: 'Hello from local.' } }] }]);
  process.env.ANTHROPIC_BASE_URL = anthropic.url;
  try {
    const logs = [];
    const models = new Models({ ...baseConfig, anthropicApiKey: 'test-key', localBaseUrl: `${local.url}/v1` }, (m) => logs.push(m));
    const tools = [{ name: 'fetch_url', localOnly: true, description: 'd', input_schema: { type: 'object', properties: {} } }];
    const turn = await models.turn({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools });
    assert.equal(turn.content[0].text, 'Hello from local.');
    assert.equal(models.usingLocal, true);
    assert.match(models.fallbackReason, /400/);
    assert.match(models.describe(), /test-model \(local\)/);
    // The local model gets the local-only tools; the API request did not.
    assert.equal(local.requests[0].body.tools[0].function.name, 'fetch_url');
    assert.equal(anthropic.requests[0].body.tools.some((t) => t.name === 'fetch_url'), false);
    // Once fallen back, later turns go straight to the local model.
    await models.turn({ system: 's', messages: [{ role: 'user', content: 'again' }], tools });
    assert.equal(anthropic.requests.length, 1);
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    anthropic.close();
    local.close();
  }
});

test('runs the agent loop: writes an allowed file, refuses others, then finishes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rook-'));
  await mkdir(join(root, 'replies'));
  const script = [
    toolCall('a', 'write_file', { path: 'VOICE.md', content: 'hijack' }),
    toolCall('b', 'read_file', { path: '../../etc/passwd' }),
    toolCall('c', 'finish', { title: 'Replies: 2026-10-19', description: 'too soon' }),
    toolCall('d', 'write_file', { path: 'replies/12-thanks.md', content: '---\nissue: 12\n---\n\nThanks.' }),
    toolCall('e', 'finish', { title: 'Replies: 2026-10-19', description: 'One reply.' }),
  ];
  const local = await fakeServer((url, body, n) => [200, script[n - 1]]);
  try {
    const models = new Models({ ...baseConfig, anthropicApiKey: '', localBaseUrl: `${local.url}/v1` }, () => {});
    const { tools, state } = makeTools({ root, writable: [/^replies\/\d+-[a-z0-9-]+\.md$/], log: () => {} });
    const result = await runAgent({ models, system: 's', prompt: 'p', tools, state, maxTurns: 10, log: () => {} });
    assert.deepEqual(result, { title: 'Replies: 2026-10-19', description: 'One reply.', skip: false });
    assert.equal(await readFile(join(root, 'replies/12-thanks.md'), 'utf8'), '---\nissue: 12\n---\n\nThanks.\n');
    const results = local.requests.slice(1).map((r) => r.body.messages.at(-1).content);
    assert.match(results[0], /Not allowed to write VOICE.md/);
    assert.match(results[1], /outside the repository/);
    assert.match(results[2], /Nothing has been written yet/);
  } finally {
    local.close();
  }
});

const failedBuild = [
  '> rookery@0.1.0 build',
  '> astro check && astro build',
  '',
  '\u001b[1m▶ Astro collects anonymous usage data.\u001b[22m',
  '  https://astro.build/telemetry',
  '',
  '21:17:02 [content] Syncing content',
  '[InvalidContentEntryDataError] posts → test data does not match collection schema.',
  '',
  '  **description**: **description: Required',
  '  **tags**: **tags: Expected type `"array"`, received `"string"`',
  '',
  '  Hint:',
  '    See https://docs.astro.build/en/guides/content-collections/ for more information on content schemas.',
  '  Location:',
  '    /repo/src/content/posts/2026-10-29-test.md:0:0',
  '  Stack trace:',
  '    at getEntryData (/repo/node_modules/astro/dist/content/utils.js:83:22)',
].join('\n');

test('keeps the useful part of a failed build', () => {
  assert.equal(
    buildErrors(failedBuild),
    [
      '[InvalidContentEntryDataError] posts → test data does not match collection schema.',
      '',
      '  description: description: Required',
      '  tags: tags: Expected type `"array"`, received `"string"`',
      '',
      '  Location:',
      '    /repo/src/content/posts/2026-10-29-test.md:0:0',
    ].join('\n'),
  );
});

test('sends build errors back and gives up when the model keeps finishing without fixing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rook-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: "node -e \"console.error('[InvalidContentEntryDataError] description: Required'); process.exit(1)\"" } }));
  const finish = { title: 'Post: x', description: 'd' };
  const script = [
    toolCall('a', 'write_file', { path: 'post.md', content: 'x' }),
    toolCall('b', 'run_build', {}),
    toolCall('c', 'finish', finish),
    toolCall('d', 'run_build', {}),
    toolCall('e', 'finish', finish),
    toolCall('f', 'finish', finish),
    toolCall('g', 'finish', finish),
  ];
  const local = await fakeServer((url, body, n) => [200, script[n - 1]]);
  try {
    const logs = [];
    const models = new Models({ ...baseConfig, anthropicApiKey: '', localBaseUrl: `${local.url}/v1` }, () => {});
    const { tools, state } = makeTools({ root, writable: [/^post\.md$/], build: true, buildHint: 'Front matter needs a description.', log: (m) => logs.push(m) });
    await assert.rejects(runAgent({ models, system: 's', prompt: 'p', tools, state, maxTurns: 20, log: (m) => logs.push(m) }), StuckError);
    assert.equal(local.requests.length, 6);
    const results = local.requests.slice(1).map((r) => r.body.messages.at(-1).content);
    assert.match(results[1], /Build FAILED[\s\S]*description: Required[\s\S]*Front matter needs a description/);
    assert.match(results[2], /can't finish yet[\s\S]*description: Required/);
    assert.match(results[3], /Nothing has changed since the last build failed/);
    assert.ok(logs.some((l) => /build failed:\n.*description: Required/.test(l)));
    assert.ok(logs.some((l) => /refused: The build is failing/.test(l)));
  } finally {
    local.close();
  }
});

test('spots a runner home inside another project', async () => {
  const outer = await mkdtemp(join(tmpdir(), 'rook-'));
  await writeFile(join(outer, 'tsconfig.json'), '{}');
  assert.equal(enclosingProject(join(outer, 'runner-home')), join(outer, 'tsconfig.json'));
  assert.equal(enclosingProject(await mkdtemp(join(tmpdir(), 'rook-'))), null);
});

test('quotes the post front matter that small models get wrong', () => {
  const post = [
    '---',
    'title: Prompt injection: the API output problem',
    'description: "Agents" trust what APIs say',
    "social: 'Already quoted, it''s fine'",
    'tags: apis, ai',
    'pubDate: 2026-10-29',
    '---',
    '',
    'Body: left alone.',
    '',
  ].join('\n');
  assert.equal(
    quoteFrontMatter(post),
    [
      '---',
      'title: "Prompt injection: the API output problem"',
      'description: "\\"Agents\\" trust what APIs say"',
      "social: 'Already quoted, it''s fine'",
      'tags: ["apis", "ai"]',
      'pubDate: 2026-10-29',
      '---',
      '',
      'Body: left alone.',
      '',
    ].join('\n'),
  );
  const tidy = '---\ntitle: "Fine"\ntags: ["a"]\n---\nx';
  assert.equal(quoteFrontMatter(tidy), tidy);
  assert.equal(quoteFrontMatter('no front matter'), 'no front matter');
});

test('write_file runs prepare before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rook-'));
  const { tools } = makeTools({ root, writable: [/^post\.md$/], prepare: (path, content) => content.toUpperCase(), log: () => {} });
  await tools.find((t) => t.name === 'write_file').run({ path: 'post.md', content: 'hi' });
  assert.equal(await readFile(join(root, 'post.md'), 'utf8'), 'HI\n');
});

test('turns HTML into readable text with links kept', () => {
  const text = htmlToText('<html><script>x()</script><p>See <a href="https://example.com/spec">the spec</a>.</p><p>Done &amp; dusted</p></html>');
  assert.equal(text, 'See the spec (https://example.com/spec).\nDone & dusted');
});

test('publish.mjs starts the deploy workflow on the default branch', async () => {
  const gh = await fakeServer((url) => (url.endsWith('/dispatches') ? [204, null] : [200, { default_branch: 'main' }]));
  try {
    const home = await mkdtemp(join(tmpdir(), 'rook-'));
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'publish.mjs');
    const { stdout } = await promisify(execFile)(process.execPath, [script], {
      env: { ...process.env, ROOK_ENV_FILE: '/dev/null', ROOK_HOME: home, ROOK_GITHUB_TOKEN: 't', ROOK_REPO: 'o/r', ROOK_GITHUB_API: gh.url },
    });
    assert.match(stdout, /Triggered deploy.yml on o\/r@main/);
    assert.deepEqual(gh.requests.map((r) => r.url), ['/repos/o/r', '/repos/o/r/actions/workflows/deploy.yml/dispatches']);
    assert.deepEqual(gh.requests[1].body, { ref: 'main' });
  } finally {
    gh.close();
  }
});
