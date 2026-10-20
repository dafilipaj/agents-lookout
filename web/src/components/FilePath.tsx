import { Fragment, type ReactNode, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { SessionFilesContext, parsePath, pathParts, vscodeHref } from '@/lib/files';
import { LINK_CLASS, linkify } from '@/lib/links';

const noSubscribe = () => () => {};

/**
 * VIEW-1.17: a path, as written. Plain text until the server says it's a file, then a link that opens
 * it in VS Code on a plain click (no new tab: Chrome hands the link over and the page stays). It
 * subscribes to its own answer, so an answer re-renders only the paths it names.
 */
export function FilePath({ text }: { text: string }) {
  const store = useContext(SessionFilesContext);
  const ref = useMemo(() => parsePath(text), [text]);
  const path = ref?.path ?? null;
  const absolute = useSyncExternalStore(store?.subscribe ?? noSubscribe, () => (store && path ? store.absolute(path) : null));
  useEffect(() => {
    if (store && path) store.want(path);
  }, [store, path]);
  if (!ref || !absolute) return text;
  return (
    <a href={vscodeHref(absolute, ref.line, ref.col)} title="Open in VS Code" className={LINK_CLASS} dir="ltr">
      {text}
    </a>
  );
}

/** Plain text with its paths as `FilePath`s. */
function filePaths(text: string): ReactNode {
  const parts = pathParts(text);
  if (!parts.some((p) => p.ref)) return text;
  return parts.map((p, i) => (p.ref ? <FilePath key={i} text={p.text} /> : <Fragment key={i}>{p.text}</Fragment>));
}

/**
 * VIEW-1.12 and 1.17: plain text with its web addresses and, between them, its file paths as links.
 * The text reads and copies as before. Never use it inside a button or a link.
 */
export function LinkedText({ text }: { text: string }) {
  return linkify(text, filePaths);
}
