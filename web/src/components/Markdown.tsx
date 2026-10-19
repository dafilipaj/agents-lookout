import { type ComponentProps, createContext, memo, useContext } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HIDDEN_CHARACTER, HIDDEN_ENCODED, LINK_CLASS, LINK_REL, linkify } from '@/lib/links';

/**
 * VIEW-1.1: an agent's reply as Markdown. Transcripts can hold anything, so:
 * - raw HTML is never rendered: it's dropped (`skipHtml`), and nothing goes through innerHTML;
 * - links work only for http(s) and mailto (and footnotes' `#` links), open in a new tab, and
 *   send no referrer;
 * - images aren't loaded; they show as a placeholder with their alt text (Non-goals).
 * VIEW-1.12: remark-gfm links bare addresses in prose; addresses in code are linked here.
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

/** Inline code and code blocks: their addresses are links too, unless the code is a link's text. */
function Code({ children, className }: ComponentProps<'code'>) {
  const inLink = useContext(InLink);
  return (
    <code className={`rounded bg-muted px-1 py-px font-mono text-[12.5px] ${className ?? ''}`}>
      {typeof children === 'string' && !inLink ? linkify(children) : children}
    </code>
  );
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
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted/60 px-3 py-2.5 font-mono text-[12px] leading-[1.55] first:mt-0 last:mb-0 dark:bg-black/25 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[12px]">
      {children}
    </pre>
  ),
  code: Code,
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

const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={plugins} components={components} skipHtml urlTransform={safeUrl}>
      {text}
    </ReactMarkdown>
  );
});
