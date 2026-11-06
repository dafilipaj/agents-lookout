import type { PlainPrFiles } from '@shared/plain.ts';
import type { WorkPr } from '@shared/work.ts';
import { Check, RotateCw } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Loading } from '@/components/ui/loading';
import { splitPath } from '@/lib/changes';
import { PrSpecsContext } from '@/lib/pr-specs';
import { routePath } from '@/lib/router';
import { cn } from '@/lib/utils';

/** PLAIN-5.3: while the list is open, a newer push is looked for this often. */
export const PR_SPECS_POLL_MS = 60_000;

/**
 * PLAIN-5.1: "Specs" under an expanded PR's or Review request's "More" (DS-16), in a repo Lookout
 * has a clone of: the PR's changed Modules, each opening the Spec view, with its Viewed mark. It is
 * mounted while the submenu is open: fetched then, and every 60 s while it stays open (PLAIN-5.3). A
 * fetch that fails says why, with Retry (PLAIN-5.4).
 */
export function PrSpecsList({ pr }: { pr: WorkPr }) {
  const specs = useContext(PrSpecsContext);
  const [answer, setAnswer] = useState<PlainPrFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const api = specs?.api;
  /** Each read's number: only the latest one's answer is shown. */
  const ask = useRef(0);

  // PLAIN-5.3: fetched on opening, then every 60 s while open; Retry (PLAIN-5.4) fetches at once.
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (!api) return;
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
  }, [api, pr.repo, pr.number, retries]);

  if (!api) return null;
  const openModule = (path: string, e: MouseEvent) => {
    // PLAIN-1.1: ⌘- or Ctrl-click opens the Spec view in a new browser tab.
    if (e.metaKey || e.ctrlKey) window.open(routePath({ name: 'plain-pr', repo: pr.repo, number: pr.number, path }), '_blank', 'noopener');
    else api.onOpen(pr.repo, pr.number, path);
  };
  const shownError = error ?? answer?.error ?? null;
  return (
    <div data-slot="pr-specs">
      {!answer && !shownError && <Loading label={`Fetching #${pr.number} from GitHub…`} className="p-2" />}
      {shownError && (
        <Alert title={shownError} className="m-1" data-field="pr-specs-error">
          <DropdownMenuItem
            data-action="retry"
            disabled={retrying}
            className="self-start"
            onSelect={(e) => {
              // Retry keeps the list open, to show what the fetch says.
              e.preventDefault();
              setRetrying(true);
              setRetries((n) => n + 1);
            }}
          >
            <RotateCw className="size-3.5" />
            Retry
          </DropdownMenuItem>
        </Alert>
      )}
      {answer && answer.files.length === 0 && !answer.error && <p className="px-2 py-1.5 text-meta text-muted-foreground">No spec changes in this PR</p>}
      {answer &&
        answer.files.map((f) => {
          const { name, folder } = splitPath(f.path);
          return (
            <DropdownMenuItem
              key={f.path}
              data-file={f.path}
              data-viewed={f.viewed || undefined}
              aria-label={`${f.path}${f.viewed ? ', viewed' : ''}, open the spec`}
              title={f.path}
              onClick={(e) => openModule(f.path, e)}
              className="min-w-0 items-baseline gap-1.5 py-1 text-meta"
            >
              {f.viewed && <Check aria-hidden data-icon="viewed" className="size-3 shrink-0 self-center text-muted-foreground" />}
              <span className={cn('min-w-0 max-w-full shrink-0 truncate', !f.viewed && 'font-medium')}>{name}</span>
              {folder && <span className="min-w-0 truncate text-muted-foreground">{folder}</span>}
            </DropdownMenuItem>
          );
        })}
    </div>
  );
}
