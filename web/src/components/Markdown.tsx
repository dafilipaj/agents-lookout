import { Check, Copy } from 'lucide-react';
import { type ComponentProps, createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { pathParts } from '@/lib/files';
import { HIDDEN_CHARACTER, HIDDEN_ENCODED, LINK_CLASS, LINK_REL, addressSpans, linkify } from '@/lib/links';
import { cn } from '@/lib/utils';
import { FilePath, LinkedText } from './FilePath';

/**
 * VIEW-1.1: an agent's reply as Markdown. Transcripts can hold anything, so:
 * - raw HTML is never rendered: it's dropped (`skipHtml`), and nothing goes through innerHTML;
 * - links work only for http(s) and mailto (and footnotes' `#` links), open in a new tab, and
 *   send no referrer;
 * - images aren't loaded; they show as a placeholder with their alt text (Non-goals).
 * VIEW-1.12: remark-gfm links bare addresses in prose; addresses in code are linked here.
 * VIEW-1.17: file paths in prose and inline code are links once the server finds the file.
 * VIEW-1.14, 1.15: code blocks have a copy button, and plain-text ones wrap.
 */
const SAFE_URL = /^(https?:|mailto:|#)/i;

/** micromark percent-encodes an IPv6 host's brackets (`<https://[::1]:8080>`): put them back. */
const ENCODED_IPV6 = /^(https?:\/\/(?:[^/?#@]*@)?)%5B([0-9a-f:.]+)%5D/i;

function safeUrl(url: string): string {
  return SAFE_URL.test(url.trim()) ? url.replace(ENCODED_IPV6, '$1[$2]') : '';
}

type Node = NonNullable<ExtraProps['node']>;
const textOf = (n: Node | Node['children'][number]): string => ('value' in n ? n.value : 'children' in n ? n.children.map(textOf).join('') : '');

/** VIEW-1.12: a bidi control or an invisible character in a link's href or text, percent-encoded or not. */
function hidesAddress(href: string, node: Node | undefined): boolean {
  return HIDDEN_CHARACTER.test(href) || HIDDEN_ENCODED.test(href) || (!!node && HIDDEN_CHARACTER.test(textOf(node)));
}

/** Set inside a link, so code in its text isn't linked again: links never nest. */
const InLink = createContext(false);
/** Set inside a code block: its code gets web links but no file links (VIEW-1.17). */
const InBlock = createContext(false);

/**
 * VIEW-1.17: how many of an inline code's first characters belong to an address that starts before
 * it, in the text around it (`https://[::1]/?f=`README.md``); set by remarkFilePaths.
 */
const ADDRESS_LEAD = 'dataAddressLead';

/**
 * Inline code and code blocks: their addresses are links too, unless the code is a link's text.
 * Inline code's file paths are links as well (VIEW-1.17), except in an address that runs into it.
 */
function Code({ children, className, node }: ComponentProps<'code'> & ExtraProps) {
  const inLink = useContext(InLink);
  const inBlock = useContext(InBlock);
  const lead = Number(node?.properties[ADDRESS_LEAD] ?? 0);
  return (
    <code className={`rounded bg-muted px-1 py-px font-mono text-[12.5px] ${className ?? ''}`}>
      {typeof children !== 'string' || inLink ? (
        children
      ) : inBlock ? (
        linkify(children)
      ) : lead > 0 ? (
        <>
          {linkify(children.slice(0, lead))}
          <LinkedText text={children.slice(lead)} />
        </>
      ) : (
        <LinkedText text={children} />
      )}
    </code>
  );
}

/** VIEW-1.15: a block in these languages, or none, is plain text: it wraps. */
const PLAIN = new Set(['text', 'txt', 'plain']);

function codeLanguage(code: Node | undefined): string | null {
  const classes = code?.properties.className;
  const lang = Array.isArray(classes) ? classes.find((c): c is string => typeof c === 'string' && c.startsWith('language-')) : undefined;
  return lang ? lang.slice('language-'.length).toLowerCase() : null;
}

/**
 * VIEW-1.14, 1.15: a fenced code block with its copy button in a box of its own, so the button stays
 * in the corner while the block scrolls sideways. A plain-text block wraps instead of scrolling.
 */
function CodeBlock({ children, node }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children.find((c): c is Node => c.type === 'element' && c.tagName === 'code');
  const lang = codeLanguage(code);
  const plain = lang === null || PLAIN.has(lang);
  // What was written between the fences: the renderer adds one line break at its end.
  const text = code ? textOf(code).replace(/\n$/, '') : '';
  return (
    <div className="group/code relative my-2 first:mt-0 last:mb-0">
      <pre
        className={cn(
          'rounded-md border border-border bg-muted/60 px-3 py-2.5 font-mono text-[12px] leading-[1.55] dark:bg-black/25 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[12px]',
          plain ? 'break-words whitespace-pre-wrap' : 'overflow-x-auto',
        )}
        data-wrap={plain || undefined}
      >
        {/* A wrapped block keeps its first line clear of the copy button at its widest ("Couldn't
            copy"), so the feedback never covers text; the lines under it keep the whole width. A
            block that scrolls can't: its code passes under the button. */}
        {plain && <span aria-hidden data-copy-room className="float-right ml-2 h-[1lh] w-28" />}
        <InBlock value>{children}</InBlock>
      </pre>
      <CopyButton text={text} />
    </div>
  );
}

/** VIEW-1.14: how long "Copied" or "Couldn't copy" shows. */
export const COPY_FEEDBACK_MS = 2000;

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // No clipboard, or the browser refused.
    }
    clearTimeout(timer.current);
    setState(copied ? 'copied' : 'failed');
    timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
  };
  const said = state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : '';
  return (
    <>
      <button
        type="button"
        aria-label="Copy code"
        title="Copy code"
        onClick={() => void copy()}
        className={cn(
          'absolute top-1.5 right-1.5 flex h-6 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[11.5px] text-muted-foreground shadow-xs select-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-hover/code:opacity-100 motion-safe:transition-opacity',
          state === 'idle' ? 'opacity-0' : 'opacity-100',
          state === 'failed' && 'text-destructive hover:text-destructive',
        )}
        data-copy={state}
      >
        {state === 'copied' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {said && <span aria-hidden>{said}</span>}
      </button>
      {/* The button keeps its name; the outcome is read out here. */}
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
  );
}

/** VIEW-1.17: marks a file path in prose, for the `span` override below. */
const FILE_PATH = 'dataFilePath';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

/** Nodes whose children are a run of inline text. */
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);
/** Inline nodes that read as part of the text around them: an address runs on through them. */
const IN_LINE = new Set(['emphasis', 'strong', 'delete', 'link', 'linkReference']);
const isLink = (node: MdNode) => node.type === 'link' || node.type === 'linkReference';

/**
 * VIEW-1.17: after remark-gfm, splits prose text outside links into text and paths, each path a
 * `span` marked with FILE_PATH that the `span` override renders as a FilePath. Code isn't text here:
 * inline code finds its own paths, and blocks have none.
 */
function remarkFilePaths() {
  const visit = (node: MdNode) => {
    if (TEXT_BLOCKS.has(node.type)) splitRun(node);
    else node.children?.forEach(visit);
  };
  return visit;
}

/**
 * Never inside a web address, also one GFM left as text (a bare IPv6 host, VIEW-1.12). Emphasis,
 * strikethrough or code can cut such an address into several nodes (`https://[::1]/?f=*x*README.md`),
 * so addresses are found in the block's text as it reads, across them, and mapped back to each node.
 */
function splitRun(block: MdNode) {
  // The text as it reads, and where each text and inline code node outside a link starts in it.
  let text = '';
  const starts = new Map<MdNode, number>();
  // Inline code that starts with an address links it (Code), even right after a word
  // (`Run`https://…``), where the text as it reads has no address starting there.
  const codeAddresses: number[] = [];
  const read = (node: MdNode, inLink: boolean) => {
    for (const child of node.children ?? []) {
      if (child.type === 'text' || child.type === 'inlineCode') {
        if (!inLink) starts.set(child, text.length);
        if (!inLink && child.type === 'inlineCode' && addressSpans(child.value ?? '')[0]?.address) codeAddresses.push(text.length);
        text += child.value ?? '';
      } else if (IN_LINE.has(child.type)) read(child, inLink || isLink(child));
      else if (child.type !== 'html') text += ' '; // a line break, an image (raw HTML isn't shown)
    }
  };
  read(block, false);
  const addresses: [number, number][] = [];
  let at = 0;
  for (const span of addressSpans(text)) {
    if (span.address) addresses.push([at, at + span.text.length]);
    at += span.text.length;
  }
  for (const start of codeAddresses) {
    if (addresses.some(([s, e]) => s <= start && start < e)) continue;
    const [span] = addressSpans(text.slice(start));
    if (span?.address) addresses.push([start, start + span.text.length]);
  }
  if (codeAddresses.length > 0) {
    // In reading order, overlapping ones merged: the writing below walks them once.
    addresses.sort((a, b) => a[0] - b[0]);
    for (let k = addresses.length - 1; k > 0; k--) {
      const [prev, cur] = [addresses[k - 1]!, addresses[k]!];
      if (cur[0] < prev[1]) {
        prev[1] = Math.max(prev[1], cur[1]);
        addresses.splice(k, 1);
      }
    }
  }
  // Nodes are written in the order they were read, so the first address that could reach one only moves on.
  let first = 0;
  const write = (node: MdNode) => {
    if (!node.children || isLink(node)) return;
    node.children = node.children.flatMap((child): MdNode[] => {
      const from = starts.get(child);
      if (from === undefined) {
        write(child);
        return [child];
      }
      const value = child.value ?? '';
      const to = from + value.length;
      while (first < addresses.length && addresses[first]![1] <= from) first++;
      if (child.type === 'inlineCode') {
        const [start, end] = addresses[first] ?? [to, to];
        if (start < from && to > from) child.data = { ...child.data, hProperties: { [ADDRESS_LEAD]: Math.min(end, to) - from } };
        return [child];
      }
      const parts: MdNode[] = [];
      let i = from;
      for (let k = first; k < addresses.length && addresses[k]![0] < to; k++) {
        const [start, end] = addresses[k]!;
        if (start > i) parts.push(...pathNodes(value.slice(i - from, start - from)));
        i = Math.min(end, to);
        parts.push({ type: 'text', value: value.slice(Math.max(start, from) - from, i - from) });
      }
      if (i < to) parts.push(...pathNodes(value.slice(i - from)));
      return parts;
    });
  };
  write(block);
}

/** Text outside addresses, its paths marked. */
function pathNodes(text: string): MdNode[] {
  return pathParts(text).map((part) => (part.ref ? { type: 'text', value: part.text, data: { hName: 'span', hProperties: { [FILE_PATH]: '' } } } : { type: 'text', value: part.text }));
}

const components: Components = {
  // A link that could read as another address (VIEW-1.12) stays text.
  a: ({ href, children, node }) =>
    !href || hidesAddress(href, node) ? (
      <span>{children}</span>
    ) : href.startsWith('#') ? (
      <a href={href} className="text-busy no-underline">
        <InLink value>{children}</InLink>
      </a>
    ) : (
      <a href={href} target="_blank" rel={LINK_REL} className={LINK_CLASS} dir="auto">
        <InLink value>{children}</InLink>
      </a>
    ),
  img: ({ alt }) => <span className="rounded bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground">[image{alt ? `: ${alt}` : ''}]</span>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-[15px] font-semibold first:mt-0">{children}</h3>,
  // remark-gfm's footnotes heading is screen-reader only: keep it so.
  h2: ({ children, className, id }) =>
    className?.includes('sr-only') ? (
      <h2 id={id} className="sr-only">
        {children}
      </h2>
    ) : (
      <h3 className="mt-4 mb-2 text-[14.5px] font-semibold first:mt-0">{children}</h3>
    ),
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-[14px] font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h5>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  pre: CodeBlock,
  code: Code,
  // Only remarkFilePaths makes spans: raw HTML is skipped.
  span: ({ children, node }) => (node && FILE_PATH in node.properties ? <FilePath text={textOf(node)} /> : <span>{children}</span>),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-max min-w-[50%] border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-border bg-muted/60 px-2.5 py-1 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-border px-2.5 py-1">
      {children}
    </td>
  ),
};

const plugins = [remarkGfm, remarkFilePaths];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml urlTransform={safeUrl}>
      {text}
    </ReactMarkdown>
  );
});
