import type { ChangedCheckout, ChangedFile, ChangesView, RowChanges } from '@shared/types.ts';
import { Check, Code, ScrollText } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { routePath } from '@/lib/router';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loading } from '@/components/ui/loading';
import { changesButtonLabel, changesTip, fileSignature as signature, filesPart, hasLines, kindLabel, noOpenReason, splitPath, viewedFiles } from '@/lib/changes';
import { cn } from '@/lib/utils';
import { ChangesCount } from './ChangesCount';

/** DIFF-4.5, 4.6: how long a file's row shows why it didn't open. */
export const OPEN_ERROR_MS = 5000;

const fileKey = (root: string, path: string) => `${root}\u0000${path}`;


export interface ChangesButtonProps {
  /** DIFF-3.7: whose files these are, for their Viewed marks. */
  sessionId: string;
  /** The row's count; null when nothing changed (the button is then gone, unless its list is open). */
  changes: RowChanges | null;
  /** The list as the server last sent it: undefined before it did, null when nothing counts. */
  list: ChangesView | null | undefined;
  /** DIFF-3.6: the list opened or closed; the server reads this Session every 3 s while it's open. */
  onOpenChange(open: boolean): void;
  /** DIFF-4: opens a file's Changes in VS Code; rejects with the reason to show. */
  onOpenFile(root: string, path: string): Promise<void>;
  /** PLAIN-3.1: a `.plain` file opens in the Spec view instead; VS Code is its second action. */
  onOpenSpec?(checkout: string, path: string): void;
  /** PLAIN-3.3: a Checkout's changed Modules that are Viewed (PLAIN-4), in place of DIFF-3.7's marks. */
  plainViewed?(checkout: string): Promise<string[]>;
  /** DIFF-3.3: where focus goes when the list closes after its count went away. */
  focusFallback(): void;
}

/**
 * DIFF-1.3, DIFF-3: the status line's count, `+120 −30 · 4 files`, a button that opens the list of
 * changed files; a file opens its Changes in VS Code (DIFF-4).
 */
export function ChangesButton({ sessionId, changes, list, onOpenChange, onOpenFile, onOpenSpec, plainViewed, focusFallback }: ChangesButtonProps) {
  const [, setViewedTick] = useState(0);
  /** PLAIN-3.3: the Viewed Modules of the open list, `<root>\0<path>`, as the server last said. */
  const [plainMarks, setPlainMarks] = useState<ReadonlySet<string>>(new Set());
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

  // PLAIN-3.3: each answer while the list is open asks which of its Modules are Viewed.
  const askMarks = useRef(plainViewed);
  useEffect(() => {
    askMarks.current = plainViewed;
  });
  useEffect(() => {
    const ask = askMarks.current;
    if (!open || !ask || !onOpenSpec || !list) return;
    let alive = true;
    const withModules = list.checkouts.filter((c) => c.files.some(isModule));
    void Promise.all(withModules.map((c) => ask(c.id).then((paths) => paths.map((p) => fileKey(c.root, p)), () => [] as string[]))).then((keys) => {
      if (alive) setPlainMarks(new Set(keys.flat()));
    });
    return () => {
      alive = false;
    };
  }, [open, list, onOpenSpec]);

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
    void onOpenFile(root, f.path).then(
      () => {
        viewedFiles.set(`${sessionId}\u0000${fileKey(root, f.path)}`, signature(f));
        setViewedTick((n) => n + 1);
      },
      (err: unknown) => showError(fileKey(root, f.path), err instanceof Error ? err.message : String(err)),
    );
  };
  const isViewed = (root: string, f: ChangedFile) => {
    if (onOpenSpec && isModule(f)) return plainMarks.has(fileKey(root, f.path));
    const k = `${sessionId}\u0000${fileKey(root, f.path)}`;
    const at = viewedFiles.get(k);
    if (at === undefined) return false;
    if (at === signature(f)) return true;
    viewedFiles.delete(k); // it changed since: unread again
    return false;
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
        <ChangesList
          list={list}
          errors={errors}
          onOpen={(c, f, e) => {
            if (onOpenSpec && isModule(f)) {
              // PLAIN-1.1: ⌘- or Ctrl-click opens the Spec view in a new browser tab.
              if (e.metaKey || e.ctrlKey) {
                window.open(routePath({ name: 'plain', session: sessionId, checkout: c.id, path: f.path }), '_blank', 'noopener');
                return;
              }
              setOpenAndTell(false);
              onOpenSpec(c.id, f.path);
            } else openFile(c.root, f);
          }}
          onOpenInCode={onOpenSpec ? (c, f) => openFile(c.root, f) : null}
          isViewed={isViewed}
        />
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

/** PLAIN-3.1: a PlainLang Module, which opens in the Spec view (a deleted one too: it shows its base). */
const isModule = (f: ChangedFile) => f.path.endsWith('.plain') && f.kind !== 'submodule' && !f.binary;

function ChangesList({
  list,
  errors,
  onOpen,
  onOpenInCode,
  isViewed,
}: {
  list: ChangesView | null | undefined;
  errors: ReadonlyMap<string, string>;
  onOpen(c: ChangedCheckout, f: ChangedFile, e: MouseEvent): void;
  /** PLAIN-3.1: a Module's second action; null when Modules open in VS Code like any file. */
  onOpenInCode: ((c: ChangedCheckout, f: ChangedFile) => void) | null;
  isViewed(root: string, f: ChangedFile): boolean;
}) {
  // DIFF-3.8: the files whose Changes differ from the previous answer while the list is open; the
  // first answer marks nothing. Adjusted while rendering, as React documents for derived state.
  const [answer, setAnswer] = useState<{ list: ChangesView | null | undefined; sigs: ReadonlyMap<string, string> | null; changed: ReadonlySet<string> }>({ list, sigs: null, changed: new Set() });
  if (answer.list !== list) {
    const sigs = list ? new Map(list.checkouts.flatMap((c) => c.files.map((f) => [fileKey(c.root, f.path), signature(f)] as const))) : null;
    const before = answer.sigs;
    const changed = new Set<string>();
    if (before && sigs) for (const [k, sig] of sigs) if (before.get(k) !== sig) changed.add(k);
    setAnswer({ list, sigs: sigs ?? before, changed });
  }
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
            {/* PLAIN-3.4: the Modules first, each group in path order (the sort is stable). */}
            {(onOpenInCode ? [...c.files].sort((a, b) => Number(isModule(b)) - Number(isModule(a))) : c.files).map((f) => {
              const key = fileKey(c.root, f.path);
              return (
                <FileRow
                  key={key}
                  fileKey={key}
                  file={f}
                  error={errors.get(key) ?? null}
                  onOpen={(e) => onOpen(c, f, e)}
                  spec={!!onOpenInCode && isModule(f)}
                  onOpenInCode={onOpenInCode && isModule(f) ? () => onOpenInCode(c, f) : null}
                  viewed={isViewed(c.root, f)}
                  justChanged={answer.changed.has(key)}
                />
              );
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

function FileRow({
  fileKey: key,
  file,
  error,
  onOpen,
  spec,
  onOpenInCode,
  viewed,
  justChanged,
}: {
  fileKey: string;
  file: ChangedFile;
  error: string | null;
  onOpen(e: MouseEvent): void;
  /** PLAIN-3.1: it opens in the Spec view. */
  spec: boolean;
  /** PLAIN-3.1: the Module's "Open in VS Code". */
  onOpenInCode: (() => void) | null;
  /** DIFF-3.7 */
  viewed: boolean;
  /** DIFF-3.8 */
  justChanged: boolean;
}) {
  const { name, folder } = splitPath(file.path);
  const kind = kindLabel(file);
  const blocked = spec ? null : noOpenReason(file);
  const label = [file.path, kind, file.binary ? 'binary' : `${file.additions} added, ${file.deletions} removed`, file.uncommitted ? 'uncommitted' : null, viewed ? 'viewed' : null, justChanged ? 'just changed' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <li className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        data-file={key}
        aria-label={blocked ? `${label}. ${blocked}` : spec ? `${label}, open the spec` : `${label}, open in VS Code`}
        aria-disabled={blocked ? true : undefined}
        title={blocked ?? file.path}
        data-viewed={viewed || undefined}
        data-just-changed={justChanged || undefined}
        onClick={(e) => {
          if (!blocked) onOpen(e);
        }}
        className={cn(
          'flex w-full min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 text-left text-meta outline-none',
          // PLAIN-3.4: a Module's row is tinted in the spec colour (DS-2.6), more under the pointer.
          spec ? 'bg-spec/10 hover:bg-spec/16 focus-visible:bg-spec/16' : 'hover:bg-accent focus-visible:bg-accent',
          blocked && 'cursor-default opacity-70',
          justChanged && 'bg-muted',
        )}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {spec && <ScrollText aria-hidden data-icon="spec" className="size-3 shrink-0 self-center text-spec-text" />}
          {/* DIFF-3.5: the folder gives way first; a name longer than the row is cut too. */}
          {viewed && <Check aria-hidden data-icon="viewed" className="size-3 shrink-0 self-center text-muted-foreground" />}
          <span className={cn('min-w-0 max-w-full shrink-0 truncate', !viewed && 'font-medium')}>{name}</span>
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
      {onOpenInCode && (
        <IconButton size="sm" label="Open in VS Code" onClick={onOpenInCode} data-field="open-in-code">
          <Code />
        </IconButton>
      )}
    </li>
  );
}
