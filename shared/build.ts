/**
 * SIDE-14: a build of the page, named by the `/assets/` files its `index.html` loads, in order: the
 * entry script, its preloads, its stylesheet. Their names carry Vite's content hashes, so any change
 * to the code or the styles changes the name. Null with none, as `pnpm dev` serves.
 */
export function buildOfHtml(html: string): string | null {
  const refs = [...html.matchAll(/\s(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!);
  return refs.length ? refs.join(' ') : null;
}
