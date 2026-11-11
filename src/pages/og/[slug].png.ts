import type { APIRoute, GetStaticPaths } from 'astro';
import { ogImage } from '../../og';
import { getPublishedPosts, formatDate, type Post } from '../../utils';
import { SITE_TAGLINE } from '../../consts';

// Link preview images: /og/<post slug>.png for each post, /og/site.png for
// every other page. Base.astro points og:image at the right one.
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getPublishedPosts();
  return [
    ...posts.map((post) => ({ params: { slug: post.id }, props: { post } })),
    { params: { slug: 'site' }, props: { post: undefined } },
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const post = props.post as Post | undefined;
  const png = await ogImage(
    post
      ? { title: post.data.title, kicker: formatDate(post.data.pubDate) }
      : { title: SITE_TAGLINE, kicker: 'A weekly blog' },
  );
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
