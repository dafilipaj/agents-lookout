import type { ChangedCheckout, ChangedFile, ChangesView, RowChanges } from '@shared/types.ts';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loading } from '@/components/ui/loading';
import { changesButtonLabel, changesTip, filesPart, hasLines, kindLabel, noOpenReason, splitPath } from '@/lib/changes';
import { cn } from '@/lib/utils';
import { ChangesCount } from './ChangesCount';

/** DIFF-4.5, 4.6: how long a file's row shows why it didn't open. */
export const OPEN_ERROR_MS = 5000;

const fileKey = (root: string, path: string) => `${root}\u0000${path}`;

export interface ChangesButtonProps {
  /** The row's count; null when nothing changed (the button is then gone, unless its list is open). */
  changes: RowChanges | null;
  /** The list as the server last sent it: undefined before it did, null when nothing counts. */
  list: ChangesView | null | undefined;
  /** DIFF-3.6: the list opened or closed; the server reads this Session every 3 s while it's open. */
  onOpenChange(open: boolean): void;
  /** DIFF-4: opens a file's Changes in VS Code; rejects with the reason to show. */
  onOpenFile(root: string, path: string): Promise<void>;
  /** DIFF-3.3: where focus goes when the list closes after its count went away. */
  focusFallback(): void;
}

/**
 * DIFF-1.3, DIFF-3: the status line's count, `+120 −30 · 4 files`, a button that opens the list of
 * changed files; a file opens its Changes in VS Code (DIFF-4).
 */
export function ChangesButton({ changes, list, onOpenChange, onOpenFile, focusFallback }: ChangesButtonProps) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const setOpenAndTell = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  // A Session switch unmounts the button: its list closes with it (DIFF-3.6).
  const told = useRef(onOpenChange);
  useEffect(() => {
    told.current = onOpenChange;
  });
  useEffect(() => () => told.current(false), []);

  if (!changes && !open) return null;

  const showError = (key: string, message: string) => {
    clearTimeout(timers.current.get(key));
    setErrors((m) => new Map(m).set(key, message));
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        setErrors((m) => {
          const next = new Map(m);
          next.delete(key);
          return next;
        });
      }, OPEN_ERROR_MS),
    );
  };
  const openFile = (root: string, f: ChangedFile) => {
    void onOpenFile(root, f.path).catch((err: unknown) => showError(fileKey(root, f.path), err instanceof Error ? err.message : String(err)));
  };

  return (
    <Popover open={open} onOpenChange={setOpenAndTell}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-field="changes"
          aria-label={changes ? changesButtonLabel(changes) : 'No changes, show changed files'}
          title={changes ? changesTip(changes) : 'No changes'}
          className={cn(
            // DS-7.3: a 24 px tall target in the 28 px line, as the status line's menus.
            'flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-sm px-1 -mx-1 text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
          )}
        >
          {hasLines(changes) && <ChangesCount additions={changes.additions} deletions={changes.deletions} />}
          <span className="truncate">{changes ? `${hasLines(changes) ? '· ' : ''}${filesPart(changes)}` : 'No changes'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[60vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto p-1"
        data-slot="changes-list"
        onKeyDown={onArrows}
        onCloseAutoFocus={(e) => {
          // DIFF-3.3: the count is gone, so focus goes where the Session view would have it.
          if (!changes) {
            e.preventDefault();
            focusFallback();
          }
        }}
      >
        <ChangesList list={list} errors={errors} onOpen={openFile} />
      </PopoverContent>
    </Popover>
  );
}

/** DIFF-3.4: Up and Down move between the files, from wherever focus is in the popover. */
function onArrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-file]')];
  if (!all.length) return;
  e.preventDefault();
  const at = all.findIndex((b) => b === document.activeElement);
  const to = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
  all[to]!.focus();
}

function ChangesList({
  list,
  errors,
  onOpen,
}: {
  list: ChangesView | null | undefined;
  errors: ReadonlyMap<string, string>;
  onOpen(root: string, f: ChangedFile): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** DIFF-3.3: the focused file, and the files as last shown, so focus can move on when it leaves. */
  const focused = useRef<string | null>(null);
  const shown = useRef<string[]>([]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const all = [...ref.current.querySelectorAll<HTMLButtonElement>('button[data-file]')];
    const keys = all.map((b) => b.dataset.file!);
    const before = shown.current;
    shown.current = keys;
    const was = focused.current;
    if (!was || keys.includes(was)) return;
    // The focused file left: the next one still listed, else the previous one, else the list itself.
    const at = before.indexOf(was);
    const to = before.slice(at + 1).find((k) => keys.includes(k)) ?? before.slice(0, Math.max(0, at)).reverse().find((k) => keys.includes(k));
    focused.current = to ?? null;
    if (to) all[keys.indexOf(to)]!.focus();
    else ref.current.focus();
  });

  if (list === undefined) {
    return (
      <div className="px-2 py-1.5">
        <Loading label="Loading changed files…" />
      </div>
    );
  }
  const checkouts = list?.checkouts ?? [];
  if (!checkouts.some((c) => c.files.length || c.moreFiles)) {
    return (
      <div ref={ref} tabIndex={-1} className="px-2 py-1.5 text-meta text-muted-foreground outline-none" data-slot="changes-empty">
        No changes
      </div>
    );
  }
  const headed = checkouts.length > 1;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Changed files"
      className="outline-none"
      onFocus={(e) => {
        const key = (e.target as HTMLElement).dataset.file;
        if (key) focused.current = key;
      }}
    >
      {checkouts.map((c) => (
        <section key={c.root} data-slot="changes-checkout" aria-label={headed ? checkoutName(c) : undefined}>
          {headed && (
            <div className="flex items-center gap-2 px-2 pt-1.5 pb-0.5 text-meta font-medium" title={c.root}>
              <span className="min-w-0 flex-1 truncate">{checkoutName(c)}</span>
              <ChangesCount additions={c.additions} deletions={c.deletions} />
            </div>
          )}
          <ul className="flex flex-col">
            {c.files.map((f) => {
              const key = fileKey(c.root, f.path);
              return <FileRow key={key} fileKey={key} root={c.root} file={f} error={errors.get(key) ?? null} onOpen={onOpen} />;
            })}
          </ul>
          {c.moreFiles > 0 && <p className="px-2 py-1 text-meta text-muted-foreground">and {c.moreFiles} more</p>}
        </section>
      ))}
    </div>
  );
}

function checkoutName(c: ChangedCheckout): string {
  return c.where ? `${c.repo} · ${c.where}` : c.repo;
}

function FileRow({ fileKey: key, root, file, error, onOpen }: { fileKey: string; root: string; file: ChangedFile; error: string | null; onOpen(root: string, f: ChangedFile): void }) {
  const { name, folder } = splitPath(file.path);
  const kind = kindLabel(file);
  const blocked = noOpenReason(file);
  const label = [file.path, kind, file.binary ? 'binary' : `${file.additions} added, ${file.deletions} removed`, file.uncommitted ? 'uncommitted' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <li>
      <button
        type="button"
        data-file={key}
        aria-label={blocked ? `${label}. ${blocked}` : `${label}, open in VS Code`}
        aria-disabled={blocked ? true : undefined}
        title={blocked ?? file.path}
        onClick={() => {
          if (!blocked) onOpen(root, file);
        }}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left text-meta outline-none',
          'hover:bg-accent focus-visible:bg-accent',
          blocked && 'cursor-default opacity-70',
        )}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {/* DIFF-3.5: the folder gives way first; a name longer than the row is cut too. */}
          <span className="min-w-0 max-w-full shrink-0 truncate font-medium">{name}</span>
          {folder && <span className="min-w-0 truncate text-muted-foreground">{folder}</span>}
        </span>
        {error ? (
          <span className="min-w-0 max-w-[60%] shrink-0 truncate text-destructive-text" data-slot="changes-error" role="status">
            {error}
          </span>
        ) : (
          <>
            {kind && <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">{kind}</span>}
            {file.binary ? <span className="shrink-0 text-muted-foreground">binary</span> : <ChangesCount additions={file.additions} deletions={file.deletions} />}
            {file.uncommitted && <span className="shrink-0 text-muted-foreground">uncommitted</span>}
          </>
        )}
      </button>
    </li>
  );
}
