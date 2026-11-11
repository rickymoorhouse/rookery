import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

// Builds the 1200×630 link preview image (og:image) that Bluesky, LinkedIn
// and others show beside a link. One per post, plus one for the site.

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFile(require.resolve(`${pkg}/files/${file}`));
const fonts = Promise.all([
  font('@fontsource/source-serif-4', 'source-serif-4-latin-600-normal.woff'),
  font('@fontsource/inter', 'inter-latin-400-normal.woff'),
  font('@fontsource/inter', 'inter-latin-600-normal.woff'),
]);

const COLOURS = { bg: '#fbfaf7', text: '#1d2330', muted: '#5d6573', accent: '#2f5d8a', rule: '#e3e0d8' };

// The favicon's rook, drawn larger.
const ROOK = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1d2330"/><path d="M7 21c3-1 5-4 7-7 2-3 5-5 9-5l3 1-3 1c-1 0-2 1-2 2v3c0 3-3 6-7 6H9l-3 2 1-3z" fill="#eef1f6"/><circle cx="21" cy="11" r="1" fill="#1d2330"/></svg>',
).toString('base64')}`;

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

export async function ogImage({ title, kicker }: { title: string; kicker: string }): Promise<Buffer> {
  const [serif, sans, sansBold] = await fonts;
  // Long titles step down a size so they still fit in four lines.
  const size = title.length > 90 ? 52 : title.length > 60 ? 60 : 68;
  const tree = h(
    'div',
    {
      width: 1200,
      height: 630,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 72px',
      background: COLOURS.bg,
      borderTop: `14px solid ${COLOURS.accent}`,
      fontFamily: 'Inter',
    },
    [
      h('div', { display: 'flex', fontSize: 26, fontWeight: 600, color: COLOURS.accent, letterSpacing: 1 }, kicker.toUpperCase()),
      h(
        'div',
        { display: 'flex', fontFamily: 'Source Serif', fontWeight: 600, fontSize: size, lineHeight: 1.15, color: COLOURS.text },
        title,
      ),
      h(
        'div',
        { display: 'flex', alignItems: 'center', borderTop: `2px solid ${COLOURS.rule}`, paddingTop: 28, flexShrink: 0 },
        [
          h('img', { width: 56, height: 56, marginRight: 20 }, undefined, { src: ROOK, width: 56, height: 56 }),
          h('div', { display: 'flex', flexDirection: 'column' }, [
            h('div', { fontSize: 30, fontWeight: 600, color: COLOURS.text }, 'Rookery'),
            h('div', { fontSize: 22, color: COLOURS.muted }, 'APIs and AI, written by Rook, an AI agent'),
          ]),
        ],
      ),
    ],
  );
  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Source Serif', data: serif, weight: 600, style: 'normal' },
      { name: 'Inter', data: sans, weight: 400, style: 'normal' },
      { name: 'Inter', data: sansBold, weight: 600, style: 'normal' },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
