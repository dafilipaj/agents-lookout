import type { DocumentAnswer } from '@shared/library.ts';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { ActionIcon, actionWord } from '@/lib/actions';
import { useCopy } from '@/lib/copy';
import { OUTPUT_ICON, TYPE_LABEL, openFile, showsInLookout } from '@/lib/outputs';
import { DOCUMENT_COLUMN, DocumentFile, type FileShown, type LoadText } from './DocumentFile';
import { PlainView } from './Shell';

export interface DocumentViewProps {
  /** The file's absolute path. */
  path: string;
  /** DOC-3.1: the file's Type and whether it's there; refused for a path the server won't read. */
  load(path: string): Promise<DocumentAnswer>;
  loadText: LoadText;
  /** DOC-2.4: to the Session it was opened from, or the place you were in. */
  onBack(): void;
  /** False while a dialog is open: Esc and `O` stand down. */
  keyboardEnabled: boolean;
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const IN_PLACE = { markdown: 'markdown', html: 'page', image: 'image' } as const;

/** DOC-2: one file in the main pane, in place of VS Code or a browser tab. */
export function DocumentView({ path, load, loadText, onBack, keyboardEnabled }: DocumentViewProps) {
  const [read, setRead] = useState<{ doc: DocumentAnswer } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    load(path).then(
      (doc) => live && setRead({ doc }),
      (err: unknown) => live && setRead({ error: message(err, "Lookout can't show this file.") }),
    );
    return () => {
      live = false;
    };
  }, [load, path]);
  const doc = read && 'doc' in read ? read.doc : null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  // DOC-2.1: its folder, the home directory as `~` once the server said where that is.
  const where = doc?.display ?? path;
  const folder = where.slice(0, Math.max(1, where.lastIndexOf('/')));
  const copy = useCopy(path);
  // DOC-2.2: a Type the view shows, from a file that's there.
  const how: FileShown | null = !doc ? null : !doc.exists ? { as: 'gone' } : doc.type !== 'pdf' && showsInLookout(doc.type) ? { as: IN_PLACE[doc.type], path: doc.path, version: 0 } : null;
  const canOpen = !!doc?.exists;
  const open = () => {
    if (doc?.exists) openFile(doc.path, doc.type);
  };
  const Icon = doc ? OUTPUT_ICON[doc.type] : null;
  const openAction = doc?.type === 'markdown' ? 'open-vscode' : 'open-external';

  // DOC-2.4, 2.5: Esc and O, from the window as a Report's keys are, with the same guards.
  const latest = useRef({ enabled: keyboardEnabled, open, onBack });
  useEffect(() => {
    latest.current = { enabled: keyboardEnabled, open, onBack };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const now = latest.current;
      if (e.isComposing || e.defaultPrevented || e.repeat || !now.enabled || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof Element && (isEditable(e.target) || e.target.closest('[data-shell-column="right"], [role="menu"]'))) return;
      const key = e.key.toLowerCase();
      if (key !== 'escape' && key !== 'o') return;
      e.preventDefault();
      if (key === 'escape') now.onBack();
      else now.open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <PlainView
      data-view="document"
      header={
        <>
          <Button variant="quiet" size="default" className="-ml-2.5 shrink-0" title="Back (Esc)" onClick={onBack} data-action="back">
            <ArrowLeft /> Back
          </Button>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="flex min-w-0 items-center gap-1.5 text-title font-semibold tracking-tight" title={name}>
              {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
              <span className="min-w-0 truncate">{name}</span>
            </h1>
            <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-meta text-muted-foreground" data-field="facts">
              {doc && (
                <>
                  <span className="shrink-0">{TYPE_LABEL[doc.type]}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span className="min-w-0 truncate" dir="ltr" title={where} data-field="folder">
                {folder}
              </span>
            </div>
          </div>
          {/* Open, then More; nothing here is Primary (DS-18.4). */}
          <div className="ml-auto flex shrink-0 items-center gap-2" data-field="actions">
            <span role="status" aria-live="polite" className={copy.said ? 'text-meta text-muted-foreground' : 'sr-only'}>
              {copy.said}
            </span>
            {canOpen && (
              <Button variant="quiet" size="default" title={`${actionWord(openAction)} (O)`} onClick={open} data-action="open">
                <ActionIcon id={openAction} />
                {actionWord(openAction)}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="md" label={`More for ${name}`} tip={actionWord('more')} data-action="more">
                  <ActionIcon id="more" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52" aria-label={`More for ${name}`} aria-labelledby={undefined} data-slot="document-menu">
                <DropdownMenuItem onSelect={() => void copy.copy()} data-action="copy">
                  <ActionIcon id="copy" />
                  Copy path
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      }
    >
      {/* A frame fills what the pane has under the header; anything longer scrolls the pane. */}
      <div className="flex min-h-full min-w-0 flex-col" data-field="document">
        {!read ? (
          <div className={DOCUMENT_COLUMN}>
            <Loading label="Reading the file…" />
          </div>
        ) : 'error' in read ? (
          <div className={DOCUMENT_COLUMN}>
            <Alert title="Lookout can't show this file." detail={read.error === "Lookout can't show this file." ? 'It is not a document Lookout listed: open it from the Library or from a path in a Session.' : read.error} data-field="unavailable" />
          </div>
        ) : how ? (
          <DocumentFile how={how} title={name} loadText={loadText} />
        ) : (
          <div className={DOCUMENT_COLUMN}>
            <Alert tone="info" title="This file opens in a browser tab." detail="Lookout shows Markdown, pages and images in place." data-field="tab-only" />
          </div>
        )}
      </div>
    </PlainView>
  );
}

function isEditable(t: Element): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
