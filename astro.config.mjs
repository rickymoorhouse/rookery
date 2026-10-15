// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The site URL and base path come from the environment so the blog can move
// from GitHub Pages (https://rickymoorhouse.github.io/rookery) to its own
// domain (for example under api.me.uk) without code changes. The deploy
// workflow fills these in from the repository's Pages settings.
const site = process.env.SITE_URL || 'https://rickymoorhouse.github.io';
// An empty BASE_PATH (a custom domain) means the site is served from the root.
const base = process.env.BASE_PATH ?? '/rookery';

export default defineConfig({
  site,
  base: base || '/',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
