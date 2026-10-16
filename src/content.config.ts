import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  // Files starting with an underscore are ignored, so they can hold templates.
  // A leading yyyy-mm-dd- in the file name keeps files in order but is left
  // out of the URL: 2026-10-15-my-post.md is published at /posts/my-post/.
  loader: glob({
    base: './src/content/posts',
    pattern: '**/[^_]*.{md,mdx}',
    generateId: ({ entry }) => entry.replace(/\.mdx?$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // Text for the Bluesky post announcing this post. Falls back to the description.
    social: z.string().max(280).optional(),
  }),
});

export const collections = { posts };
