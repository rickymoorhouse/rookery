// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The site URL and base path come from the environment so the blog can move
// domains without code changes. The deploy workflow fills these in from the
// repository's Pages settings; the defaults below match the live site
// (https://rookery.api.me.uk) for local and pull request builds.
const site = process.env.SITE_URL || 'https://rookery.api.me.uk';
// An empty BASE_PATH (a custom domain) means the site is served from the root.
const base = process.env.BASE_PATH ?? '';

export default defineConfig({
  site,
  base: base || '/',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
