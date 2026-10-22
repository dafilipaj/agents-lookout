import { Fragment, type ReactNode } from 'react';

/**
 * How the chat's web links look and open (VIEW-1.12): in a new tab, sending no referrer, in their
 * own case even under an uppercase header. Markdown's links too. Each link is a bidi isolate
 * (`dir`), so a right-to-left override before it can't reverse it into another address. A link is
 * underlined in the text colour around it, never a Status colour (DS-3.6); the underline stays on hover.
 */
export const LINK_CLASS = 'normal-case underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
export const LINK_REL = 'noopener noreferrer nofollow';

/**
 * Bidi controls and invisible characters (U+061C, U+200B–200F, U+202A–202E, U+2060, U+2066–2069,
 * U+FEFF): inside an address they make its text read as another address, so an address ends at one.
 */
const HIDDEN = '\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF';
export const HIDDEN_CHARACTER = new RegExp(`[${HIDDEN}]`);
/** The same characters percent-encoded, as in a Markdown link's href. */
export const HIDDEN_ENCODED = /%D8%9C|%E2%80%(?:8[B-F]|A[A-E])|%E2%81%(?:A0|A[6-9])|%EF%BB%BF/i;

/** `http://` or `https://`, up to whitespace, a backtick, `<`, `>`, a hidden character or one of `stops`. */
const run = (stops: string) => `https?://[^\\s\`<>${HIDDEN}${stops}]+`;
/**
 * An address. A quote ends it only when the same quote opens right before it, so `'https://x.dev'`
 * and `["https://x.dev"]` end at the quote and `…/wiki/Murphy's_law` keeps it. Only these two
 * schemes: `javascript:`, `file:`, `data:` and the rest stay text.
 */
const ADDRESS = new RegExp(`(?<=")${run('"')}|(?<=')${run("'")}|\\b${run('')}`, 'gi');
/**
 * Sentence punctuation and quotes after an address belong to the sentence, and Markdown's `*`,
 * `_` and `~` to the Markdown: GFM's autolinks cut the same, so code links where prose does.
 */
const PUNCTUATION = `.,;:!?"'*_~`;
/** A closing bracket the address doesn't open belongs to the text around it, e.g. `(see https://x.dev)`. */
const CLOSES: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * Trims trailing punctuation and unbalanced closing brackets; balanced ones stay (`…/wiki/Foo_(bar)`).
 * Linear: the brackets are counted once, and the count drops as closing ones are cut off.
 */
function trimAddress(url: string): string {
  const unopened: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
  for (const c of url) {
    if (c in unopened) unopened[c]!++;
    else if (c in CLOSES) unopened[CLOSES[c]!]!--;
  }
  let end = url.length;
  for (; end > 0; end--) {
    const last = url[end - 1]!;
    if (PUNCTUATION.includes(last)) continue;
    if ((unopened[last] ?? 0) <= 0) break;
    unopened[last]!--;
  }
  return url.slice(0, end);
}

export interface TextPart {
  text: string;
  /** Set when `text` is an http(s) address. */
  href: string | null;
}

/** The text cut into plain runs and http(s) addresses, in order: joined, they're the text exactly. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  for (const m of text.matchAll(ADDRESS)) {
    const url = trimAddress(m[0]);
    if (!URL.canParse(url)) continue; // nothing after the scheme, e.g. `https://.`
    if (m.index > from) parts.push({ text: text.slice(from, m.index), href: null });
    parts.push({ text: url, href: url });
    from = m.index + url.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), href: null });
  return parts;
}

export interface AddressSpan {
  text: string;
  /** Inside an http(s) address, whether it's linked or not. */
  address: boolean;
}

/**
 * The text cut into runs outside and inside http(s) addresses, in order: joined, they're the text
 * exactly. Every address counts, also one that isn't linked: one that doesn't parse, or a bare IPv6
 * host that GFM leaves as text in prose. VIEW-1.17 looks for file paths only outside them.
 */
export function addressSpans(text: string): AddressSpan[] {
  const spans: AddressSpan[] = [];
  let from = 0;
  for (const m of text.matchAll(ADDRESS)) {
    const address = trimAddress(m[0]);
    if (m.index > from) spans.push({ text: text.slice(from, m.index), address: false });
    spans.push({ text: address, address: true });
    from = m.index + address.length;
  }
  if (from < text.length) spans.push({ text: text.slice(from), address: false });
  return spans;
}

/** `between` on the text outside every address; addresses stay text. */
function outsideAddresses(text: string, between: (text: string) => ReactNode): ReactNode {
  const spans = addressSpans(text);
  if (!spans.some((s) => s.address)) return between(text);
  return spans.map((s, i) => (s.address ? s.text : <Fragment key={i}>{between(s.text)}</Fragment>));
}

/**
 * VIEW-1.12: plain text with its http(s) addresses as links. The text reads and copies as before:
 * each link holds exactly the characters it replaces. Never use it inside a button or a link.
 * `between` renders the text outside addresses (VIEW-1.17's file paths), so nothing it finds is ever
 * inside one, linked or not.
 */
export function linkify(text: string, between?: (text: string) => ReactNode): ReactNode {
  const parts = textParts(text);
  if (!parts.some((p) => p.href)) return between ? outsideAddresses(text, between) : text;
  return parts.map((p, i) =>
    p.href ? (
      <a key={i} href={p.href} target="_blank" rel={LINK_REL} className={LINK_CLASS} dir="ltr">
        {p.text}
      </a>
    ) : between ? (
      <Fragment key={i}>{outsideAddresses(p.text, between)}</Fragment>
    ) : (
      p.text
    ),
  );
}
