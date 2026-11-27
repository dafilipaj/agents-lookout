import { type ReactNode, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Loading } from '@/components/ui/loading';
import type { DocumentShown } from '@/lib/inbox';
import { framedFileUrl } from '@/lib/outputs';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

/** The main pane's column for text, the chat's (INBOX UX: "the chat's column"), with 24 px above it. */
export const DOCUMENT_COLUMN = 'mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 px-6 pt-6 pb-8';
/** INBOX-2.9: the frame's sandbox, the one the file route sends (LIB-3.3): scripts run, storage doesn't, links open as ordinary tabs. */
export const FRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

export type LoadText = (path: string) => Promise<{ text: string; truncated: boolean }>;
/** A file that shows in place: Markdown, a page or an image from its path, or one that is gone. */
export type FileShown = Exclude<DocumentShown, { as: 'card' }>;

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** A column of text that takes the arrow keys, so they scroll it (GUIDE, "A document shown in place"). */
export function Prose({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} data-scroll-keys className={cn(DOCUMENT_COLUMN, 'flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset')}>
      {children}
    </div>
  );
}

/**
 * INBOX-2.4, DOC-2.2: one file, shown in place by its Type: Markdown rendered, a page in a sandboxed
 * frame that fills the pane, an image at its own size. A Report's document and the Document view's.
 */
export function DocumentFile({ how, title, loadText }: { how: FileShown; title: string; loadText: LoadText }) {
  if (how.as === 'markdown') return <MarkdownFile key={`${how.path}:${how.version}`} title={title} path={how.path} loadText={loadText} />;
  if (how.as === 'page') {
    // A page brings its own colours, so its frame is white, edge to edge under the header.
    return <iframe key={`${how.path}:${how.version}`} src={framedFileUrl(how.path)} title={title} sandbox={FRAME_SANDBOX} referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" data-field="page" />;
  }
  if (how.as === 'image') {
    return (
      <div className={DOCUMENT_COLUMN} data-field="image">
        {/* At its own size, no wider than the pane. */}
        <img key={`${how.path}:${how.version}`} src={framedFileUrl(how.path)} alt={title} className="max-w-full self-start" />
      </div>
    );
  }
  return (
    <div className={DOCUMENT_COLUMN}>
      <Alert tone="info" title="This file no longer exists." detail="Resume the Session that wrote it to have it written again." data-field="gone" />
    </div>
  );
}

/** INBOX-2.4: a Markdown file, rendered as the chat renders Markdown (VIEW-1.6), from at most its first megabyte. */
function MarkdownFile({ title, path, loadText }: { title: string; path: string; loadText: LoadText }) {
  const [file, setFile] = useState<{ text: string; truncated: boolean } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    loadText(path).then(
      (got) => live && setFile(got),
      (err: unknown) => live && setFile({ error: message(err, "Couldn't read it.") }),
    );
    return () => {
      live = false;
    };
  }, [loadText, path]);
  if (!file) {
    return (
      <div className={DOCUMENT_COLUMN}>
        <Loading label="Reading the file…" />
      </div>
    );
  }
  if ('error' in file) {
    return (
      <div className={DOCUMENT_COLUMN}>
        <Alert title="Couldn't read this file" detail={file.error} data-field="file-error" />
      </div>
    );
  }
  return (
    <Prose label={title}>
      {file.truncated && <Alert tone="info" layout="inline" title="This file is long: only its first megabyte is shown. Open has the rest." data-field="truncated" />}
      <div className="max-w-[42rem] text-reading break-words" data-field="markdown">
        <Markdown text={file.text} reading />
      </div>
    </Prose>
  );
}
