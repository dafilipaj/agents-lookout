/**
 * SIDE-14: the build this tab runs, named as the server names the page it serves (`buildOfHtml`):
 * the `/assets/` files the document loads, in order; null with none, as under `pnpm dev`.
 */
export function buildOfDocument(doc: Document): string | null {
  const refs = [...doc.querySelectorAll('[src^="/assets/"], [href^="/assets/"]')].map((el) => el.getAttribute('src') ?? el.getAttribute('href')!);
  return refs.length ? refs.join(' ') : null;
}

/** Read once, as the page loads, before a lazy chunk adds a preload or a stylesheet of its own. */
export const PAGE_BUILD: string | null = typeof document === 'undefined' ? null : buildOfDocument(document);
