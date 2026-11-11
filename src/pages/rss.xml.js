import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { getPublishedPosts, url } from '../utils';

// Feed readers resolve links against the feed, not the post, so the post's
// relative links (../other-post/, /favicon.svg) are made absolute here.
function absolutise(html, base) {
  return html.replace(/\b(href|src)="([^"]*)"/g, (whole, attr, value) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value)) return whole;
    return `${attr}="${new URL(value, base).href}"`;
  });
}

export async function GET(context) {
  const posts = await getPublishedPosts();
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site,
    customData: '<language>en-gb</language>',
    items: posts.map((post) => {
      const link = new URL(url(`/posts/${post.id}/`), context.site).href;
      return {
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        categories: post.data.tags,
        link,
        // The whole post, so people can read it in their feed reader.
        content: post.rendered?.html ? absolutise(post.rendered.html, link) : undefined,
      };
    }),
  });
}
