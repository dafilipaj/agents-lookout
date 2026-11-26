import { BOTS_READ_ONLY, type BotRun, type BotsSnapshot, type ReportDetail, type ReportMark, inFlight, reportsOf } from '@shared/bots.ts';
import type { OutputItem } from '@shared/library.ts';
import type { HistoryItem, SessionRow } from '@shared/types.ts';
import { Bot, CircleHelp } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { Tabs } from '@/components/ui/tabs';
import { ActionIcon, actionWord } from '@/lib/actions';
import { useCopy } from '@/lib/copy';
import { type SessionAction, documentShown, outputType, reportTitle, sessionAction, whenWords } from '@/lib/inbox';
import { OUTPUT_ICON, TYPE_LABEL, canOpenOutput, framedFileUrl, openOutput } from '@/lib/outputs';
import { routePath } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { InboxChoice } from './InboxList';
import { Markdown } from './Markdown';
import { PlainView } from './Shell';

export interface ReportViewProps {
  /** The open Report's run, from the path; null on `/inbox` with none open. */
  id: string | null;
  /** INBOX-2.3: the open document, 1 for the first. */
  doc: number;
  bots: BotsSnapshot | null;
  loaded: boolean;
  /** The live Sessions, for INBOX-2.7's Open Session. */
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  view: InboxChoice;
  /** INBOX-2: reads one Report. */
  load(runId: string): Promise<ReportDetail>;
  /** INBOX-2.4: a Markdown file's text. */
  loadText(path: string): Promise<{ text: string; truncated: boolean }>;
  /** INBOX-2.3: another document of the Report; it replaces the history entry. */
  onDoc(doc: number): void;
  /** INBOX-3.1, 3.2: read or unread. */
  onMark(runId: string, mark: ReportMark): Promise<unknown>;
  /** INBOX-4.1: archive it, or move it back; once the server kept it, App selects its neighbour. */
  onArchive(run: BotRun, archived: boolean): Promise<unknown>;
  /** INBOX-2.7: Open, Resume or Show its Session. */
  onOpenSession(run: BotRun, session: HistoryItem | null): void;
  /** BOT-4.3: shows the start of a run that has no Session yet, where its Trust prompt is answered. */
  onOpenStart(launchId: string): void;
  /** INBOX-2.2: opens the Bots tab on its Bot. */
  onShowBot(botId: string): void;
  /** INBOX-5.1: false while a dialog owns the keyboard. */
  keyboardEnabled: boolean;
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
/** The main pane's column for text, the chat's (INBOX UX: "the chat's column"), with 24 px above it. */
const COLUMN = 'mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 px-6 pt-6 pb-8';
/** INBOX-2.9: the frame's sandbox, the one the file route sends (LIB-3.3): scripts run, storage doesn't, links open as ordinary tabs. */
const FRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

/** INBOX-2: one Report in the main pane. */
export function ReportView(props: ReportViewProps) {
  const { id, bots, loaded, view } = props;
  // INBOX-2.1: the run comes from the snapshot; one that never arrived isn't a Report.
  const run = id === null ? undefined : bots?.runs.find((r) => r.id === id && r.arrivedAt !== null);

  if (id === null) {
    // Before the first snapshot nothing is known: not the hint, which would give way a moment later.
    if (!loaded) {
      return (
        <PlainView>
          <Loading label="Looking for Reports…" className="p-8" />
        </PlainView>
      );
    }
    // INBOX-1.5's words when there is none to pick.
    const none = reportsOf(bots?.runs ?? [], view === 'archived').length === 0;
    return (
      <PlainView aria-label="Inbox" data-testid="report-view">
        {none ? (
          <EmptyState role="status" className="h-full justify-center p-8" title={view === 'archived' ? 'Nothing archived' : 'Nothing has arrived'} hint={view === 'archived' ? undefined : "A Bot's Report arrives here when its run ends."} />
        ) : (
          <EmptyState role="status" className="h-full justify-center p-8" title="Select a Report" hint="What its run produced shows here: its page or its notes, or its last reply." />
        )}
      </PlainView>
    );
  }
  if (!run) {
    return (
      <PlainView aria-label="Report" data-testid="report-view" header={<h1 className="text-title font-semibold tracking-tight">Report</h1>}>
        {loaded ? (
          // INBOX-2.1: a path whose run the server doesn't have.
          <EmptyState role="status" title="This Report is gone" hint="Its run is no longer kept, or its link is wrong." />
        ) : (
          <Loading label="Reading the Report…" className="p-8" />
        )}
      </PlainView>
    );
  }
  return <OneReport {...props} run={run} />;
}

interface Read {
  detail: ReportDetail | null;
  error: string | null;
}

/** INBOX-2: a Report the snapshot has: its header from the run, and under it what the server read for it. */
function OneReport({ run, doc, bots, sessions, load, loadText, onDoc, onMark, onArchive, onOpenSession, onOpenStart, onShowBot, keyboardEnabled }: ReportViewProps & { run: BotRun }) {
  const title = reportTitle(run);
  // BOT-2.6: a second server shows Reports and saves nothing.
  const readOnly = bots?.state === 'read-only';

  // INBOX "Reading one": read when the view opens (App keys it by run), and again when the run arrives
  // again or its state changes; what was read stays shown meanwhile.
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    let live = true;
    load(run.id).then(
      (detail) => live && setRead({ detail, error: null }),
      (err: unknown) => live && setRead((before) => ({ detail: before?.detail ?? null, error: message(err, "Couldn't read what it produced.") })),
    );
    return () => {
      live = false;
    };
  }, [load, run.id, run.arrivedAt, run.state]);
  const detail = read?.detail ?? null;

  // INBOX-3.1: shown, so read: marked once for each time it arrives. "Mark unread" (INBOX-3.2) leaves it
  // open and unread, and a refusal (BOT-2.6) is neither shown nor tried again.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (seen.current === run.arrivedAt) return;
    seen.current = run.arrivedAt;
    // The mark names the arrival that shows: should the Report arrive again first, it stays unread.
    if (!run.read) onMark(run.id, { read: true, arrivedAt: run.arrivedAt }).catch(() => {});
  }, [onMark, run.id, run.arrivedAt, run.read]);
  // INBOX-4.1: an Archive, or a Mark unread, the server refused: said above the Report until the next try.
  const [refused, setRefused] = useState<string | null>(null);

  // INBOX-2.3: its documents, the one updated last first; the open one is the path's. A run that is
  // still going (waiting on you, INBOX-2.6) shows none yet, so it has none to open either.
  const outputs = inFlight(run) ? [] : (detail?.outputs ?? []);
  const at = Math.min(Math.max(1, doc), Math.max(1, outputs.length));
  const shown = outputs[at - 1] ?? null;
  const session = sessionOf(run, sessions, read);
  const bot = bots?.bots.find((b) => b.id === run.botId);
  const copy = useCopy(`${window.location.origin}${routePath({ name: 'inbox', id: run.id, doc: at })}`);

  const openSession = () => (session?.kind === 'start' && run.launchId ? onOpenStart(run.launchId) : onOpenSession(run, detail?.session ?? null));
  const open = () => {
    if (shown && canOpenOutput(shown)) openOutput(shown);
  };
  const archive = () => {
    if (readOnly) return;
    setRefused(null);
    onArchive(run, !run.archived).catch((err: unknown) => setRefused(message(err, run.archived ? "Couldn't move it to the Inbox." : "Couldn't archive it.")));
  };
  const markUnread = () => {
    setRefused(null);
    onMark(run.id, { read: false, arrivedAt: run.arrivedAt }).catch((err: unknown) => setRefused(message(err, "Couldn't mark it unread.")));
  };

  // INBOX-5.1: E, O and S, from the window as the list's keys are, with the same guards.
  const latest = useRef({ enabled: keyboardEnabled, archive, open, openSession, session });
  useEffect(() => {
    latest.current = { enabled: keyboardEnabled, archive, open, openSession, session };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const now = latest.current;
      if (e.isComposing || e.defaultPrevented || e.repeat || !now.enabled || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.target instanceof Element && (isEditable(e.target) || e.target.closest('[data-shell-column="right"], [role="menu"]'))) return;
      const key = e.key.toLowerCase();
      if (key !== 'e' && key !== 'o' && key !== 's') return;
      e.preventDefault();
      if (key === 'e') now.archive();
      else if (key === 'o') now.open();
      else if (now.session) now.openSession();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const archiveButton = (
    <Button variant="quiet" size="default" disabled={readOnly} title={run.archived ? 'Move to Inbox (E)' : 'Archive (E)'} onClick={archive} data-action="archive">
      <ActionIcon id={run.archived ? 'unarchive' : 'archive'} />
      {run.archived ? 'Move to Inbox' : actionWord('archive')}
    </Button>
  );
  return (
    <PlainView
      aria-label={`Report ${title}`}
      data-testid="report-view"
      data-report-id={run.id}
      header={
        // INBOX-2.2: a Topic view's header: the title, its facts under it, the actions at the right.
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="min-w-0 truncate text-title font-semibold tracking-tight" title={title}>
              {title}
            </h1>
            <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-meta text-muted-foreground" data-field="facts">
              {bot ? (
                <Button variant="quiet" size="line" className="-ml-1.5 min-w-0 shrink font-normal" title={`Show ${run.botName} in Bots`} onClick={() => onShowBot(run.botId)} data-field="bot">
                  <Bot aria-hidden />
                  <span className="min-w-0 truncate">{run.botName}</span>
                </Button>
              ) : (
                // Its Bot was deleted since: its name, with no Bot to show.
                <span className="min-w-0 truncate" title="This Bot was deleted" data-field="bot">
                  {run.botName}
                </span>
              )}
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate" title={whenWords(run)} data-field="when">
                {whenWords(run)}
              </span>
            </div>
          </div>
          {/* The Session's first, then Open, Archive and More; none is Primary (DS-18.4). */}
          <div className="ml-auto flex shrink-0 items-center gap-2" data-field="actions">
            <span role="status" aria-live="polite" className={copy.said ? 'text-meta text-muted-foreground' : 'sr-only'}>
              {copy.said}
            </span>
            {session && (
              <Button variant="secondary" size="default" title={`${session.word} (S)`} onClick={openSession} data-action="session">
                <ActionIcon id={session.action} />
                {session.word}
              </Button>
            )}
            {/* INBOX-2.8: a Report with no document to open has no Open. */}
            {shown && canOpenOutput(shown) && (
              <Button variant="quiet" size="default" title="Open (O)" onClick={open} data-action="open">
                <ActionIcon id="open-external" />
                {actionWord('open-external')}
              </Button>
            )}
            {/* BOT-2.6: disabled on a second server, which says why where the pointer still reaches. */}
            {readOnly ? (
              <span className="inline-flex" title={BOTS_READ_ONLY}>
                {archiveButton}
              </span>
            ) : (
              archiveButton
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="md" label={`More for ${title}`} tip={actionWord('more')} data-action="more">
                  <ActionIcon id="more" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52" aria-label={`More for ${title}`} aria-labelledby={undefined} data-slot="report-menu">
                <DropdownMenuItem onSelect={() => void copy.copy()} data-action="copy">
                  <ActionIcon id="copy" />
                  Copy link
                </DropdownMenuItem>
                {/* INBOX-3.2: it stays open, unread until it's selected again. */}
                <DropdownMenuItem disabled={readOnly || !run.read} onSelect={markUnread} data-action="mark-unread">
                  <ActionIcon id="mark-unread" />
                  {actionWord('mark-unread')}
                </DropdownMenuItem>
                {readOnly && (
                  <>
                    <DropdownMenuSeparator />
                    <p role="note" className="max-w-64 px-2 py-1 text-meta text-muted-foreground">
                      {BOTS_READ_ONLY}
                    </p>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      }
    >
      {/* A frame fills what the pane has left under the strip; anything longer scrolls the pane. */}
      <div className="flex min-h-full min-w-0 flex-col [&>[role=tabpanel]]:min-h-0 [&>[role=tabpanel]]:flex-1" data-field="report">
        {refused && (
          <div className={cn(COLUMN, 'shrink-0 pb-0')}>
            <Alert title="That wasn't saved" detail={refused} data-field="refused" />
          </div>
        )}
        <ReportBody run={run} read={read} at={at} session={session} loadText={loadText} onDoc={onDoc} onOpenSession={openSession} />
      </div>
    </PlainView>
  );
}

/**
 * INBOX-2.7: the Session's action. A live Session's is known from the Session list; whether a past one
 * can be resumed is History's to say, so its button waits for the read.
 */
function sessionOf(run: BotRun, sessions: ReadonlyMap<string, SessionRow>, read: Read | null): SessionAction | null {
  const action = sessionAction(run, sessions, read?.detail?.session ?? null);
  return action && (action.kind === 'open' || action.kind === 'start' || read) ? action : null;
}

interface BodyProps {
  run: BotRun;
  read: Read | null;
  /** The open document, 1 for the first. */
  at: number;
  session: SessionAction | null;
  loadText: ReportViewProps['loadText'];
  onDoc(doc: number): void;
  onOpenSession(): void;
}

/** INBOX-2.3 to 2.6: what the Report holds, by what its run came to. */
function ReportBody({ run, read, at, session, loadText, onDoc, onOpenSession }: BodyProps) {
  // INBOX-2.6: a run waiting on you is what its Report is for: one card, its one button Primary.
  if (run.state === 'waiting') {
    return (
      <div className={COLUMN}>
        <section aria-label="Waiting on you" className="rounded-lg border border-needs-you/60 bg-needs-you-soft px-4 py-3" data-field="waiting">
          <p className="flex items-center gap-1.5 text-meta font-medium text-needs-you-text">
            <CircleHelp aria-hidden className="size-3.5 shrink-0" />
            It&apos;s waiting on you
          </p>
          {run.waitingFor && (
            <p className="mt-1.5 text-prose break-words" data-field="waiting-for">
              {run.waitingFor}
            </p>
          )}
          {session && (
            <div className="mt-3">
              <Button variant="primary" size="default" onClick={onOpenSession} data-action="waiting-session">
                <ActionIcon id={session.action} />
                {session.word}
              </Button>
            </div>
          )}
        </section>
      </div>
    );
  }
  // You answered and it went on: it arrives again when it ends (INBOX-1.1).
  if (inFlight(run)) {
    return (
      <div className={COLUMN}>
        <Alert tone="info" title="It's running again" detail="Its Report arrives again when the run ends." data-field="running" />
      </div>
    );
  }

  const detail = read?.detail ?? null;
  const outputs = detail?.outputs ?? [];
  const notices: ReactNode[] = [];
  // INBOX-2.6: what failed and why (BOT-4.5), then whatever the run did produce.
  if (run.state === 'failed') notices.push(<Alert key="failed" title="This run failed" detail={run.failure ?? 'It gave no reason.'} data-field="failed" />);
  if (read?.error) notices.push(<Alert key="read" title="Couldn't read what it produced" detail={read.error} data-field="read-error" />);
  // INBOX UX: a Library that can't be read says so above the reply.
  if (detail?.outputsError) notices.push(<Alert key="library" title="Couldn't list what it produced" detail={detail.outputsError} data-field="library-error" />);
  const top = notices.length > 0 && <div className={cn(COLUMN, 'shrink-0 pb-0')}>{notices}</div>;

  if (!read) {
    return (
      <>
        {top}
        <div className={COLUMN}>
          <Loading label="Reading what it produced…" />
        </div>
      </>
    );
  }
  if (outputs.length === 0) {
    return (
      <>
        {top}
        {detail && <LastReply run={run} reply={detail.reply} listed={!detail.outputsError} />}
      </>
    );
  }
  // INBOX-2.3: more than one document: a tab strip names each by its title and Type word. Only the
  // open one is drawn, so the others' pages aren't loaded behind it.
  if (outputs.length > 1) {
    const ids = outputs.map((_, i) => String(i + 1));
    return (
      <>
        {top}
        <Tabs
          label="Documents"
          className="sticky top-0 z-10 bg-background px-4"
          selected={String(at)}
          onSelect={(next) => onDoc(Number(next))}
          tabs={outputs.map((item, i) => ({ id: ids[i]!, label: item.title, note: typeLabel(item) }))}
          panels={Object.fromEntries(outputs.map((item, i) => [ids[i]!, i + 1 === at ? <ReportDocument key={docKey(item)} item={item} loadText={loadText} /> : null]))}
        />
      </>
    );
  }
  return (
    <>
      {top}
      <ReportDocument key={docKey(outputs[0]!)} item={outputs[0]!} loadText={loadText} />
    </>
  );
}

const docKey = (item: OutputItem) => `${item.kind}:${item.key}`;
const typeLabel = (item: OutputItem) => {
  const type = outputType(item);
  return type ? TYPE_LABEL[type] : 'File';
};

/** INBOX-2.5: a run that produced no Output shows its Session's last reply, as the chat renders one. */
function LastReply({ run, reply, listed }: { run: BotRun; reply: string | null; listed: boolean }) {
  if (!reply?.trim()) {
    // A failed run's Alert already says what became of it.
    if (run.state === 'failed' || !listed) return null;
    return (
      <div className={COLUMN}>
        <p className="text-body text-muted-foreground" data-field="no-reply">
          It finished without a reply.
        </p>
      </div>
    );
  }
  return (
    <Prose label="Its last reply">
      <p className="text-meta text-muted-foreground" data-field="reply-line">
        {listed ? 'It wrote no document. This is its last reply.' : 'This is its last reply.'}
      </p>
      <div className="max-w-[42rem] text-reading break-words" data-field="reply">
        <Markdown text={reply} reading />
      </div>
    </Prose>
  );
}

/**
 * Text read in the chat's column. INBOX-5.1: it takes focus on a click or by Tab, and ↑/↓ from inside
 * it scroll the pane (`data-scroll-keys`, SIDE-5.1) instead of moving through the Reports.
 */
function Prose({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} data-scroll-keys className={cn(COLUMN, 'flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset')}>
      {children}
    </div>
  );
}

/** INBOX-2.4: one document, shown in place by its Type. */
function ReportDocument({ item, loadText }: { item: OutputItem; loadText: ReportViewProps['loadText'] }) {
  const how = documentShown(item);
  if (how.as === 'markdown') return <MarkdownFile key={`${how.path}:${how.version}`} title={item.title} path={how.path} loadText={loadText} />;
  if (how.as === 'page') {
    // A page brings its own colours, so its frame is white, edge to edge under the header.
    return <iframe key={`${how.path}:${how.version}`} src={framedFileUrl(how.path)} title={item.title} sandbox={FRAME_SANDBOX} referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" data-field="page" />;
  }
  if (how.as === 'image') {
    return (
      <div className={COLUMN} data-field="image">
        {/* At its own size, no wider than the pane. */}
        <img key={`${how.path}:${how.version}`} src={framedFileUrl(how.path)} alt={item.title} className="max-w-full self-start" />
      </div>
    );
  }
  if (how.as === 'gone') {
    return (
      <div className={COLUMN}>
        <Alert tone="info" title="This file no longer exists." detail="Resume the Session that wrote it to have it written again." data-field="gone" />
      </div>
    );
  }
  // A PDF, a Share, an Artifact whose source file is gone: a browser tab is the only place it can be read.
  const type = outputType(item);
  const Icon = type ? OUTPUT_ICON[type] : null;
  return (
    <div className={COLUMN}>
      <section aria-label={item.title} className="flex min-w-0 flex-col items-start gap-3 rounded-lg border border-border px-4 py-3" data-field="card">
        <div className="flex min-w-0 max-w-full flex-col gap-0.5">
          <p className="flex min-w-0 items-center gap-1.5 text-body font-medium">
            {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
            <span className="min-w-0 truncate">{item.title}</span>
          </p>
          <p className="text-meta break-all text-muted-foreground">
            {typeLabel(item)} · {item.display}
          </p>
        </div>
        {canOpenOutput(item) && (
          <Button variant="primary" size="default" onClick={() => openOutput(item)} data-action="card-open">
            <ActionIcon id="open-external" />
            {actionWord('open-external')}
          </Button>
        )}
      </section>
    </div>
  );
}

/** INBOX-2.4: a Markdown file, rendered as the chat renders Markdown (VIEW-1.6), from at most its first megabyte. */
function MarkdownFile({ title, path, loadText }: { title: string; path: string; loadText: ReportViewProps['loadText'] }) {
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
      <div className={COLUMN}>
        <Loading label="Reading the file…" />
      </div>
    );
  }
  if ('error' in file) {
    return (
      <div className={COLUMN}>
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

function isEditable(t: Element): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
