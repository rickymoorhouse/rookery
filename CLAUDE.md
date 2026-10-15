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
