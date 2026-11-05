import type { PlainPrFiles } from '@shared/plain.ts';
import type { WorkPr } from '@shared/work.ts';
import { Check, FileText } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RowAction } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { splitPath } from '@/lib/changes';
import { PrSpecsContext } from '@/lib/pr-specs';
import { routePath } from '@/lib/router';
import { cn } from '@/lib/utils';

/** PLAIN-5.3: while the list is open, a newer push is looked for this often. */
export const PR_SPECS_POLL_MS = 60_000;

/**
 * PLAIN-5.1: "Specs" on an expanded PR or Review request, in a repo Lookout has a clone of: the PR's
 * changed Modules, each opening the Spec view, with its Viewed mark. A fetch that fails says why,
 * with Retry (PLAIN-5.4).
 */
export function PrSpecsAction({ pr, open, onOpenChange: setOpen }: { pr: WorkPr; open: boolean; onOpenChange(open: boolean): void }) {
  const specs = useContext(PrSpecsContext);
  const anchor = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [answer, setAnswer] = useState<PlainPrFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const api = specs?.api;
  /** Each read's number: only the latest one's answer is shown. */
  const ask = useRef(0);

  // PLAIN-5.3: fetched on opening, then every 60 s while open; Retry (PLAIN-5.4) fetches at once.
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (!open || !api) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async (fresh: boolean) => {
      const id = ++ask.current;
      try {
        const next = await api.list(pr.repo, pr.number, fresh);
        if (alive && id === ask.current) {
          setAnswer(next);
          setError(null);
        }
      } catch (err) {
        if (alive && id === ask.current) setError(err instanceof Error ? err.message : String(err));
      }
      if (alive) setRetrying(false);
      if (alive) timer = setTimeout(() => void read(false), PR_SPECS_POLL_MS);
    };
    void read(true);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, api, pr.repo, pr.number, retries]);

  const retry = () => {
    setRetrying(true);
    setRetries((n) => n + 1);
  };

  if (!specs?.clones?.has(pr.repo.toLowerCase())) return null;

  const openModule = (path: string, e: MouseEvent) => {
    // PLAIN-1.1: ⌘- or Ctrl-click opens the Spec view in a new browser tab.
    if (e.metaKey || e.ctrlKey) {
      window.open(routePath({ name: 'plain-pr', repo: pr.repo, number: pr.number, path }), '_blank', 'noopener');
      return;
    }
    setOpen(false);
    specs.api.onOpen(pr.repo, pr.number, path);
  };
  const shownError = error ?? answer?.error ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span ref={anchor} className="inline-flex">
          <RowAction data-action="specs" label="Specs" icon={<FileText />} tip="This PR's changed specs (.plain) (S)" onPress={() => setOpen(!open)} />
        </span>
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        side="bottom"
        align="start"
        className="max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-1"
        data-slot="pr-specs"
        aria-label={`Specs in ${pr.repo} #${pr.number}`}
        // A click or key in the list is the list's, never the Work row's under it (WORK-1.12).
        onClick={(e) => e.stopPropagation()}
        // Closing gives focus back to Work's list, whose keys reach the row's actions (WORK-1.7), unless
        // it closed because focus went to another control: that one keeps it.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const at = document.activeElement;
          const lost = !at || at === document.body || !at.isConnected || !!content.current?.contains(at);
          if (lost) anchor.current?.closest<HTMLElement>('[role="listbox"]')?.focus();
        }}
        // Esc too: the popover closes on it (Radix listens first), and the row stays expanded.
        onKeyDown={(e) => {
          onArrows(e);
          e.stopPropagation();
        }}
      >
        {!answer && !shownError && <Loading label={`Fetching #${pr.number}`} className="p-2" />}
        {shownError && (
          <Alert title={shownError} className="m-1" data-field="pr-specs-error">
            <Button variant="outline" size="xs" className="self-start" disabled={retrying} onClick={retry} data-action="retry">
              Retry
            </Button>
          </Alert>
        )}
        {answer && answer.files.length === 0 && !answer.error && <p className="px-2 py-1.5 text-meta text-muted-foreground">No spec changes in this PR</p>}
        {answer && answer.files.length > 0 && (
          <ul className="flex flex-col" aria-label="Changed specs">
            {answer.files.map((f) => {
              const { name, folder } = splitPath(f.path);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    data-file={f.path}
                    data-viewed={f.viewed || undefined}
                    aria-label={`${f.path}${f.viewed ? ', viewed' : ''}, open the spec`}
                    title={f.path}
                    onClick={(e) => openModule(f.path, e)}
                    className="flex w-full min-w-0 items-baseline gap-1.5 rounded-sm px-2 py-1 text-left text-meta outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    {f.viewed && <Check aria-hidden data-icon="viewed" className="size-3 shrink-0 self-center text-muted-foreground" />}
                    <span className={cn('min-w-0 max-w-full shrink-0 truncate', !f.viewed && 'font-medium')}>{name}</span>
                    {folder && <span className="min-w-0 truncate text-muted-foreground">{folder}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Up and Down move between the Modules, as in DIFF's list (DIFF-3.4). */
function onArrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-file]')];
  if (!all.length) return;
  e.preventDefault();
  const at = all.findIndex((b) => b === document.activeElement);
  const to = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
  all[to]!.focus();
}
