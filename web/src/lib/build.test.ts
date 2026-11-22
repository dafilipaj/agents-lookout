import { buildOfHtml } from '@shared/build.ts';
import { describe, expect, it } from 'vitest';
import { buildOfDocument } from './build';

/** What `vite build` writes, with a preload. */
const BUILT = `<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" href="/favicon.svg?v=lens" type="image/svg+xml" />
    <title>Lookout</title>
    <script type="module" crossorigin src="/assets/index-BkITQuji.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-x9Q2.js">
    <link rel="stylesheet" crossorigin href="/assets/index-D27yda7X.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

/** What `pnpm dev` serves: Vite's client and the source entry, no build. */
const DEV = `<!doctype html>
<html><head><script type="module" src="/@vite/client"></script></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('naming a build (SIDE-14)', () => {
  it('SIDE-14.1: the tab and the server name a build the same way: its /assets/ files in order; a dev page has none', () => {
    expect(buildOfHtml(BUILT)).toBe('/assets/index-BkITQuji.js /assets/vendor-x9Q2.js /assets/index-D27yda7X.css');
    expect(buildOfDocument(parse(BUILT))).toBe(buildOfHtml(BUILT));
    // A change to the styles alone is a new build.
    const restyled = BUILT.replace('index-D27yda7X.css', 'index-Zz99.css');
    expect(buildOfDocument(parse(restyled))).not.toBe(buildOfHtml(BUILT));
    expect(buildOfHtml(DEV)).toBeNull();
    expect(buildOfDocument(parse(DEV))).toBeNull();
  });
});
