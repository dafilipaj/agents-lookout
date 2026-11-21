import { OUTCOME_WORD, ROUND_WORD, roundsNote, runsNote, type EvidenceFile, type EvidenceReviewer, type EvidenceRound, type EvidenceRun, type EvidenceView, type RowEvidence, type VerdictTone } from '@shared/evidence.ts';
import { ChevronRight, ChevronUp, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { SectionLabel, Tile, Tiles, Verdict } from '@/components/ui/details';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PART_ROW, PartRowContent, type PartLook } from '@/components/ui/status-part';
import { splitPath } from '@/lib/changes';
import { clock, doneFacts, number, plural, reviewerWords, reviewState, ROUND_VALUE, TONE_TEXT } from '@/lib/evidence';
import { HARNESS_NAME } from '@/lib/sessions';
import { formatAge, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ChangesCount } from './ChangesCount';

/** EVID-5.11: outcomes in the warning colour; EVID-6.5: in the normal text colour, never the warning one. */
const BAD = new Set(['failed', 'timed-out']);
/** EVID-5.10, EVID-5.11: rows before "N more". */
export const RUNS_SHOWN = 20;
/** DIFF-4.5: how long a file's row shows why it didn't open, as the changed-files list does. */
const OPEN_ERROR_MS = 5000;

/** EVID-5.7: a verdict's icon in its tone: never a colour alone. */
const ICON: Record<VerdictTone, { Icon: typeof CircleCheck; className: string }> = {
  ok: { Icon: CircleCheck, className: 'text-ok' },
  warning: { Icon: TriangleAlert, className: 'text-warning-text' },
  quiet: { Icon: Info, className: 'text-muted-foreground' },
};

export function VerdictIcon({ tone, className }: { tone: VerdictTone; className?: string }) {
  const { Icon, className: colour } = ICON[tone];
  return <Icon aria-hidden data-icon={`verdict-${tone}`} className={cn('size-3.5 shrink-0', colour, className)} />;
}

export interface EvidenceActions {
  /** DIFF-4: opens a changed file as the changed-files list does (a `.plain` one in the Spec view, PLAIN-3.1); rejects with the reason to show. */
  onOpenFile(file: EvidenceFile): Promise<void>;
  /** EVID-5.4: closes the popover and opens the changed-files list (DIFF-3). */
  onOpenChanges(): void;
  /** EVID-6.6: closes the popover and opens a headless reviewer's Session read-only (HIST-3.3). */
  onShowReviewer(harness: 'codex' | 'claude', sessionId: string): void;
}

interface PopoverProps extends EvidenceActions {
  view: EvidenceView;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** What opens it: the status line's part, or the Done card's button. */
  trigger: ReactNode;
  /** `right` from a row of the status line's "N more" (VIEW-5.19). */
  side: 'top' | 'bottom' | 'right';
  align: 'start' | 'end';
  /** EVID-5.8: focus doesn't return to the opener (the files list takes it, or the Evidence went). */
  onCloseAutoFocus?(event: Event): void;
}

/** EVID-5.2: the Evidence popover, from whichever part opened it. */
export function EvidencePopover({ view, open, onOpenChange, trigger, side, align, onCloseAutoFocus, ...actions }: PopoverProps) {
  const titleId = useId();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="max-h-[min(36rem,80vh)] w-[22rem] overflow-x-hidden overflow-y-auto p-0"
        aria-labelledby={titleId}
        data-slot="evidence"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <h2 id={titleId} className="sr-only">Evidence: {view.verdict.text}</h2>
        <EvidenceDetails view={view} {...actions} />
      </PopoverContent>
    </Popover>
  );
}

/** EVID-5.2 to 5.4, 5.10, 5.11, EVID-6.4, 6.5: the verdict, four tiles, what changed since the last pass, the Review rounds and the runs. */
export function EvidenceDetails({ view, onOpenFile, onOpenChanges, onShowReviewer }: { view: EvidenceView } & EvidenceActions) {
  const now = useNow();
  const age = formatAge(Math.max(0, now - view.readAt));
  const t = view.testFiles;
  const capped = view.listedFiles < view.changedFiles;
  const testValue = t.count ? `${capped ? 'at least ' : ''}${number(t.count)}${capped ? '' : ` of ${number(view.changedFiles)}`}` : 'None';
  const testParts = [t.added ? `${number(t.added)} added` : null, t.deleted ? `${number(t.deleted)} deleted` : null].filter(Boolean);
  const lines = t.additions || t.deletions ? <ChangesCount additions={t.additions} deletions={t.deletions} dropZero /> : null;
  const testLine = t.count ? (
    <>
      {capped && `of ${number(view.changedFiles)}${testParts.length || lines ? ' · ' : ''}`}
      {testParts.join(' · ')}
      {testParts.length > 0 && lines && ' · '}
      {lines}
    </>
  ) : `of ${plural(view.changedFiles, 'changed file')}`;
  const testName = `Test files: ${t.count ? `${capped ? 'at least ' : ''}${number(t.count)}` : 'none'} of ${plural(view.changedFiles, 'changed file')}, show the changed files`;
  const lastPass = view.lastPass;
  return (
    <div className="divide-y divide-border text-body">
      <header className="flex flex-col gap-2.5 px-3.5 py-3">
        <Verdict level={view.verdict.tone === 'warning' ? 'warning' : 'normal'} age={view.error ? `stale · ${age}` : `${age} ago`} flagged={!!view.error}>
          {view.verdict.text}
        </Verdict>
        {view.error && (
          // EVID-1.8: as Memory's and res's old readings say.
          <p className="text-meta text-info-text" data-field="evidence-error">
            Couldn't read the Session's commands: {view.error}. Showing the read from {clock(view.readAt)}.
          </p>
        )}
        {capped && (
          <p className="text-meta text-muted-foreground" data-field="evidence-capped">
            Read from {number(view.listedFiles)} of {number(view.changedFiles)} changed files
          </p>
        )}
        <Tiles>
          <Tile label="Last pass" value={lastPass ? clock(lastPass.end) : 'None'} level={lastPass ? 'normal' : 'warning'} field="tile-last-pass">
            {lastPass ? (lastPass.passed !== null ? `${plural(lastPass.passed, 'test')} passed` : 'by its exit code') : view.runCount ? plural(view.runCount, 'test run') : 'No test run'}
          </Tile>
          <Tile label="Changed since" value={view.changedSince ? plural(view.changedSince, 'file') : 'None'} level={view.changedSince ? 'warning' : 'normal'} field="tile-changed-since">
            {view.lastChange !== null ? `last at ${clock(view.lastChange)}` : null}
          </Tile>
          <Tile label="Test files" value={testValue} field="tile-test-files" onClick={onOpenChanges} aria-label={testName}>
            {testLine}
          </Tile>
          <ReviewTile view={view} />
        </Tiles>
      </header>
      {lastPass && view.changedSinceFiles.length > 0 && <ChangedSince view={view} onOpenFile={onOpenFile} onOpenChanges={onOpenChanges} onShowReviewer={onShowReviewer} />}
      {(view.rounds ?? []).length > 0 && <Reviews rounds={view.rounds} now={now} onShowReviewer={onShowReviewer} />}
      <Runs runs={view.runs} />
    </div>
  );
}

/** EVID-5.10: the files changed since the last pass, latest first; a press opens one as DIFF-4 does. */
function ChangedSince({ view, onOpenFile, onOpenChanges }: { view: EvidenceView } & EvidenceActions) {
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const more = view.changedSince - view.changedSinceFiles.length;
  const open = (f: EvidenceFile) => {
    const key = `${f.root}\u0000${f.path}`;
    void onOpenFile(f).catch((err: unknown) => {
      clearTimeout(timers.current.get(key));
      setErrors((m) => new Map(m).set(key, err instanceof Error ? err.message : String(err)));
      timers.current.set(key, setTimeout(() => setErrors((m) => { const next = new Map(m); next.delete(key); return next; }), OPEN_ERROR_MS));
    });
  };
  return (
    <section className="px-3.5 py-3" aria-label="Changed since the last pass" data-section="changed-since">
      <SectionLabel className="mb-1">Changed since the last pass</SectionLabel>
      <ul className="flex flex-col">
        {view.changedSinceFiles.map((f) => {
          const key = `${f.root}\u0000${f.path}`;
          const { name, folder } = splitPath(f.path);
          const error = errors.get(key);
          return (
            <li key={key}>
              <button
                type="button"
                data-file={key}
                className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 -mx-1.5 text-left text-meta outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                title={f.path}
                aria-label={`${f.path}, changed at ${clock(f.mtime)}, ${f.binary ? 'binary' : `${f.additions} added, ${f.deletions} removed`}, open in VS Code`}
                onClick={() => open(f)}
              >
                {/* DIFF-3.5: the folder gives way first. */}
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="min-w-0 max-w-full shrink-0 truncate font-medium">{name}</span>
                  {folder && <span className="min-w-0 truncate text-muted-foreground">{folder}</span>}
                </span>
                {error ? (
                  <span className="min-w-0 max-w-[60%] shrink-0 truncate text-destructive-text" role="status" data-slot="evidence-open-error">{error}</span>
                ) : (
                  <>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{clock(f.mtime)}</span>
                    {f.binary ? <span className="shrink-0 text-muted-foreground">binary</span> : <ChangesCount additions={f.additions} deletions={f.deletions} />}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <Button variant="link" size="line" className="-ml-2" onClick={onOpenChanges} data-field="changed-since-more">
          {number(more)} more
        </Button>
      )}
    </section>
  );
}

/** EVID-6.4: the Review tile: a running round, else the latest finished one, else the latest's outcome, else none. Text, never a warning. */
function ReviewTile({ view }: { view: EvidenceView }) {
  const rounds = view.rounds ?? [];
  const { running, finished, latest } = reviewState(rounds);
  const count = plural(rounds.length, 'round');
  let value: string;
  let line: string;
  if (running) {
    value = 'Running';
    line = `since ${clock(running.start)}${rounds.length > 1 ? ` · ${count}` : ''}`;
  } else if (finished) {
    value = clock(finished.end!);
    line = [count, view.changedSinceReview ? `${plural(view.changedSinceReview, 'file')} since` : null].filter(Boolean).join(' · ');
  } else if (latest) {
    value = ROUND_VALUE[latest.outcome as keyof typeof ROUND_VALUE] ?? 'Unread';
    line = count;
  } else {
    value = 'None';
    line = 'no review run';
  }
  return (
    <Tile label="Review" value={value} field="tile-review">
      {line}
    </Tile>
  );
}

/** EVID-6.5, EVID-6.6: the Review rounds, the latest start first; each headless reviewer opens its Session read-only. */
function Reviews({ rounds, now, onShowReviewer }: { rounds: readonly EvidenceRound[]; now: number } & Pick<EvidenceActions, 'onShowReviewer'>) {
  return (
    <section className="px-3.5 py-3" aria-label="Reviews" data-section="reviews">
      <SectionLabel className="mb-1" note={roundsNote(rounds)}>Reviews</SectionLabel>
      <ul className="flex flex-col gap-0.5 text-meta">
        {rounds.map((r) => <RoundRow key={r.key} round={r} now={now} onShowReviewer={onShowReviewer} />)}
      </ul>
    </section>
  );
}

function RoundRow({ round, now, onShowReviewer }: { round: EvidenceRound; now: number } & Pick<EvidenceActions, 'onShowReviewer'>) {
  const at = clock(round.end ?? round.start);
  const took = formatAge(Math.max(0, (round.end ?? now) - round.start));
  return (
    <li className="flex min-w-0 items-baseline gap-2" data-round={round.key} data-outcome={round.outcome}>
      <span className="shrink-0 text-muted-foreground tabular-nums" title={round.runs.join('\n')} data-field="round-time">{at}</span>
      {/* EVID-6.8: a review is a fact, never a warning: no warning colour, even for one that failed. */}
      <span className={cn('w-14 shrink-0', round.outcome === 'finished' || BAD.has(round.outcome) ? 'text-foreground' : 'text-muted-foreground')} data-field="outcome">
        {ROUND_WORD[round.outcome]}
      </span>
      <span className="w-7 shrink-0 tabular-nums text-muted-foreground" data-field="took">{took}</span>
      {/* EVID-6.5: reviewers that don't fit go on to more lines, under the first. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1" data-field="reviewers">
        {round.reviewers.map((r, i) => (
          <span key={r.kind === 'headless' ? r.sessionId : `subagent:${r.model ?? ''}`} className="flex min-w-0 max-w-full items-baseline gap-1">
            {i > 0 && <span aria-hidden className="text-muted-foreground">+</span>}
            <Reviewer reviewer={r} at={at} onShowReviewer={onShowReviewer} />
          </span>
        ))}
      </span>
    </li>
  );
}

/** EVID-6.6: a headless reviewer is a button that opens it read-only; a Subagent, or one whose Transcript is gone, is text. */
function Reviewer({ reviewer, at, onShowReviewer }: { reviewer: EvidenceReviewer; at: string } & Pick<EvidenceActions, 'onShowReviewer'>) {
  const words = reviewerWords(reviewer);
  if (reviewer.kind === 'subagent' || reviewer.transcriptMissing) {
    return <span className="min-w-0 truncate text-muted-foreground" title={words} data-reviewer={reviewer.kind}>{words}</span>;
  }
  return (
    <button
      type="button"
      data-reviewer="headless"
      className="min-w-0 truncate rounded-sm px-1 -mx-1 text-left text-foreground outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
      title={words}
      aria-label={`Show the ${HARNESS_NAME[reviewer.harness]} review of ${at}`}
      onClick={() => onShowReviewer(reviewer.harness, reviewer.sessionId)}
    >
      {words}
    </button>
  );
}

/** EVID-5.11: the Test runs, newest first, one line each; the label's note counts them. */
function Runs({ runs }: { runs: readonly EvidenceRun[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? runs : runs.slice(0, RUNS_SHOWN);
  return (
    <section className="px-3.5 py-3" aria-label="Test runs" data-section="runs">
      <SectionLabel className="mb-1" note={runsNote(runs)}>Test runs</SectionLabel>
      {runs.length ? (
        <ul className="flex flex-col gap-0.5 text-meta">
          {shown.map((r) => <RunRow key={r.key} run={r} />)}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">No test run.</p>
      )}
      {runs.length > shown.length && (
        <Button variant="link" size="line" className="-ml-2" onClick={() => setAll(true)} data-field="runs-more">
          {number(runs.length - shown.length)} more
        </Button>
      )}
    </section>
  );
}


function RunRow({ run }: { run: EvidenceRun }) {
  const total = (run.passed ?? 0) + (run.failed ?? 0);
  const count = run.passed === null ? null : run.failed ? `${number(run.failed)} of ${number(total)}` : plural(total, 'test');
  const command = run.command.replace(/\s+/g, ' ').trim();
  const shown = `${run.subagent ? 'Subagent · ' : ''}${command}`;
  return (
    <li className="flex min-w-0 items-baseline gap-2" data-run={run.key} data-outcome={run.outcome} title={run.command}>
      <span className="shrink-0 text-muted-foreground tabular-nums">{clock(run.end)}</span>
      <span className={cn('w-14 shrink-0', BAD.has(run.outcome) ? 'font-medium text-warning-text' : run.outcome === 'passed' ? 'text-foreground' : 'text-muted-foreground')} data-field="outcome">
        {OUTCOME_WORD[run.outcome]}
      </span>
      {count && <span className="shrink-0 tabular-nums" data-field="count">{count}</span>}
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" data-field="command">{shown}</span>
    </li>
  );
}

/**
 * EVID-5.1: the status line's part: the verdict's icon and its short words in its tone, a button
 * that opens the popover; its tooltip the whole verdict.
 */
export const EvidencePart = ({ evidence, look = 'line', ...rest }: { evidence: RowEvidence; look?: PartLook } & ComponentProps<'button'>) => (
  <button
    type="button"
    data-field="evidence"
    aria-label={`Evidence: ${evidence.text}`}
    title={evidence.text}
    data-part-row={look === 'row' || undefined}
    className={
      look === 'row'
        ? PART_ROW
        : cn(
            // DS-7.3: a 24 px tall target in the 28 px line, as the status line's other buttons.
            'flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-sm px-1 -mx-1 text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'hover:bg-accent data-[state=open]:bg-accent',
          )
    }
    {...rest}
  >
    {look === 'row' ? (
      // VIEW-5.19: folded into "N more", its row opens the same popover.
      <PartRowContent name="Evidence" icon={<VerdictIcon tone={evidence.tone} />} value={<span className={TONE_TEXT[evidence.tone]}>{evidence.short}</span>} trail={<ChevronRight className="size-3.5" />} />
    ) : (
      <>
        <VerdictIcon tone={evidence.tone} />
        <span className={cn('whitespace-nowrap', TONE_TEXT[evidence.tone])}>{evidence.short}</span>
      </>
    )}
  </button>
);

/** EVID-5.5: the Done card's one line: the verdict, two facts in the muted colour, cut, and the Evidence button. */
export function DoneEvidenceLine({ view, button }: { view: EvidenceView; button: ReactNode }) {
  const facts = doneFacts(view);
  const whole = facts ? `${view.verdict.text} · ${facts}` : view.verdict.text;
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 border-t border-border pt-2 text-meta" data-field="done-evidence">
      <VerdictIcon tone={view.verdict.tone} />
      <span className="min-w-0 flex-1 truncate" title={whole}>
        <span className={TONE_TEXT[view.verdict.tone]}>{view.verdict.text}</span>
        {facts && <span className="text-muted-foreground"> · {facts}</span>}
      </span>
      {button}
    </div>
  );
}

/** EVID-5.5: the Done card's button that opens the popover. */
export const EvidenceButton = (props: ComponentProps<typeof Button>) => (
  <Button variant="quiet" size="line" data-field="evidence-button" {...props}>
    Evidence
    <ChevronUp aria-hidden />
  </Button>
);
