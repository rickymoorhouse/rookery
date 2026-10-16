import { getPublishedPosts, url } from '../utils';

// Published posts with their announcement text. The deploy workflow reads this
// from the live site to post anything new to Bluesky (scripts/announce-bluesky.mjs).
export async function GET(context) {
  const posts = await getPublishedPosts();
  const items = posts.map((post) => ({
    url: new URL(url(`/posts/${post.id}/`), context.site).href,
    title: post.data.title,
    description: post.data.description,
    text: post.data.social ?? post.data.description,
    pubDate: post.data.pubDate.toISOString(),
  }));
  return new Response(JSON.stringify(items, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
