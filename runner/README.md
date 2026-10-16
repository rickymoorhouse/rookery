# Rook's local runner

Runs Rook's weekly run from your own machine instead of a Claude cloud session. It follows the
same plan as the "Rook weekly post" scheduled task and the weekly run in `CLAUDE.md`:

1. **Numbers.** Reads `latest.md` from the `stats` branch and notes if it is missing or stale.
2. **Comments.** Finds comments on the `comments` issues that are newer than Rook's last reply
   (and newer than any open `Replies:` PR), has Rook draft reply files in `replies/`, and pushes
   them as `Replies: <date>`.
3. **Post.** Skips the week if an earlier post PR is still unmerged (and says so on that PR, as
   the scheduled task does). Otherwise Rook picks a topic, researches it, writes this Thursday's
   post with a `social` line, updates `IDEAS.md`, gets `npm run build` passing, and pushes it as
   `Post: <title>` with the numbers summary, sources and open questions in the description.

Each result is pushed as Rook to a `claude/rook-…` branch. `.github/workflows/open-pr.yml` then
opens the pull request from Rook's account and assigns it to Ricky, exactly as for cloud runs.
Nothing is ever pushed to `main`.

## Models

Rook writes with Claude (`claude-opus-5-5` by default) through the Anthropic API, with web search
and web fetch. If an API call fails after the SDK's retries (an outage, a rate limit, an expired
key, no credit), the run switches to a local model for the rest of the run and carries on with
the same conversation. Any OpenAI-compatible endpoint works; the defaults suit
[Ollama](https://ollama.com) with `gpt-oss:20b`. With no `ANTHROPIC_API_KEY` set, every run uses
the local model.

The PR description always says which model wrote it, and asks for a closer review when the
local model was involved. A refusal from Claude is not treated as an error: the task stops
rather than handing the same request to another model.

The local model needs a model that supports tool calling, and a context window big enough for
`VOICE.md`, `CLAUDE.md`, the ideas list and its research: 32K tokens at least. Ollama's default
is smaller, so start it with `OLLAMA_CONTEXT_LENGTH=32768 ollama serve` (or set it in the Ollama
app's settings). Local models are slower and weaker writers; expect drafts that need more editing.

## What Rook can and can't touch

The model works through a handful of tools: list and read files in the checkout, write files,
fetch web pages, and run the site build. It can only write the files its task allows
(`replies/<issue>-<slug>.md` for replies; this Thursday's post and `IDEAS.md` for the post), and
`finish` refuses until the build passes and the post's front matter checks out. The runner, not
the model, handles git, the GitHub token and pull requests, and it re-runs the build and checks
the changed files itself before pushing.

The runner works in its own clone (`~/.rookery-runner/repo` by default), so it never touches your
working copy. Logs go to `~/.rookery-runner/logs/<date>.log`.

## Setup

Needs Node 20 or later and git.

```sh
cd runner
npm install
cp .env.example .env     # then fill it in
npm run check            # checks GitHub, the Anthropic API and the local model
```

`ROOK_GITHUB_TOKEN` is Rook's GitHub token, the same one stored as the repository secret. It
needs to push branches (contents: write) and comment on pull requests and issues. Pushes made
with it trigger the `open-pr.yml` workflow, which opens the PR.

All settings are in [`.env.example`](.env.example). Variables set in the environment override the
file, and `ROOK_ENV_FILE` points at a different file.

## Running it

```sh
node rook.mjs                 # the full weekly run
node rook.mjs --dry-run       # everything except pushing and commenting; inspect the commit in ~/.rookery-runner/repo
node rook.mjs --only=post     # just the post (or --only=replies)
node rook.mjs --date=2026-10-19   # act as if today were another date
```

A run is safe to repeat: if this week's branches already exist on GitHub, or this Thursday's post
is already on `main` or in an open PR, it skips that part.

## Scheduling

Run it on Monday mornings, like the cloud task (07:58 UK time).

- **macOS:** edit the paths in [`schedule/uk.api.rookery.runner.plist`](schedule/uk.api.rookery.runner.plist),
  copy it to `~/Library/LaunchAgents/` and `launchctl load` it. launchd catches up on a run missed
  while the Mac was asleep.
- **Linux or macOS with cron:** add the line in [`schedule/crontab.txt`](schedule/crontab.txt) with
  `crontab -e`. cron skips runs while the machine is off.

Pause the cloud "Rook weekly post" scheduled task once this is running, or both will try to write
the same week's post.

## Tests

```sh
npm test
```
