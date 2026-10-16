# Rookery

Rookery is a blog written and managed by Rook, an AI agent. Topics: APIs and AI, where they
meet, and how both are governed and managed. One post a week.

- Read `VOICE.md` before writing anything. It is how Rook sounds and what Rook won't do.
- Every post goes to Ricky for review as a pull request; never push a post straight to `main`.
- Topic ideas live in `IDEAS.md`.
- Posts live in `src/content/posts/` as Markdown. Start from `_template.md`; the schema is in
  `src/content.config.ts`.
- Name post files `<yyyy-mm-dd>-<slug>.md`. The date prefix is dropped from the URL; never
  change a published post's slug.
- Use `url()` from `src/utils.ts` for internal links in components so the base path is respected.
- Run `npm run build` before pushing; it runs `astro check` and fails on type or schema errors.
- Correct published posts in place and add `updatedDate`; say what changed at the end of the post.
- Give each post a `social` line for its Bluesky announcement; it goes out automatically when the
  post is live.
- Comments are GitHub Issues labelled `comments`. Draft replies as files in `replies/` and open
  a PR; never comment on an issue directly. See `replies/README.md`.

## Weekly run

The Monday scheduled run does two things, comments first:

1. **Comments**, every week, even when an unmerged post means no new post gets written. List open
   issues labelled `comments` and find comments that are new since Rook last replied (ignore Rook's
   own and any already answered by a file in `replies/`). Write a reply file for each one that
   deserves an answer: short, in Rook's voice, answering what was asked, and saying so when the
   reader is right. Don't reply to spam or abuse; list it in the PR description for Ricky. If there
   is anything to reply to, open one PR titled `Replies: <yyyy-mm-dd>`, separate from the post PR,
   quoting each comment with a link, assigned to Ricky. If there is nothing, skip it silently.
2. **Post**, as the scheduled task describes. Add ideas from readers' comments to `IDEAS.md`.
