import { BLOCK_REASON } from '@shared/history.ts';
import type { ChatPage, Harness, HistoryDetail } from '@shared/types.ts';
import { CircleSlash, GitBranch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Loading } from '@/components/ui/loading';
import type { Chat as ChatState } from '@/lib/store';
import { HARNESS_NAME } from '@/lib/sessions';
import { formatAge } from '@/lib/time';
import { Chat } from './Chat';
import { AddToTopicButton } from './TopicLinks';
import { historyMember } from '@/lib/topics';
import { HarnessIcon } from './HarnessIcon';
import { DockNote, StatusBar } from './SessionView';
import { PaneHeader, PlainView, ShellCell, ShellView } from './Shell';

interface Props {
  harness: Harness;
  sessionId: string;
  now: number;
  load(harness: Harness, sessionId: string): Promise<HistoryDetail>;
}

const noEarlier = (): Promise<ChatPage> => Promise.reject(new Error('A past Session shows only this preview of its messages.'));
const noop = () => {};

/**
 * HIST-3.3: a past Session that can't be resumed, read-only: its latest messages in VIEW's chat,
 * and why it can't be resumed.
 */
export function PastSessionView({ harness, sessionId, now, load }: Props) {
  const [state, setState] = useState<{ key: string; detail: HistoryDetail | null; error: string | null } | null>(null);
  const key = `${harness}:${sessionId}`;
  useEffect(() => {
    let live = true;
    load(harness, sessionId).then(
      (detail) => live && setState({ key, detail, error: null }),
      (err: unknown) => live && setState({ key, detail: null, error: err instanceof Error ? err.message : "Couldn't load it." }),
    );
    return () => {
      live = false;
    };
  }, [harness, sessionId, key, load]);

  const current = state?.key === key ? state : null;
  const detail = current?.detail ?? null;
  const chat = useMemo<ChatState | null>(
    () =>
      detail ? { loaded: true, entries: detail.entries, queue: [], before: null, problem: null, epoch: 1, following: true } : null,
    [detail],
  );

  if (!current) {
    return (
      <PlainView>
        <Loading label="Loading…" className="p-8" />
      </PlainView>
    );
  }
  if (!detail) {
    return (
      <PlainView>
        <div className="mx-auto w-full max-w-3xl px-8 py-7">
          <Alert title="Couldn't open this past Session" detail={current.error} />
        </div>
      </PlainView>
    );
  }
  const { item } = detail;
  // SIDE-8.1: laid out like an ended Session: a one-line header, the chat, and in the dock the note
  // on why it's read-only with where it ran under it, like a live Session's status line.
  const where = [item.projectPath, item.branch].filter(Boolean).join(' · ');
  const noteTitle = item.blocked ? `This Session can't be resumed. ${BLOCK_REASON[item.blocked]}` : 'A past Session, shown read-only.';
  const note = previewNote(detail);
  return (
    <ShellView data-testid="past-session">
      <PaneHeader aria-label="Past Session">
        <h1 className="min-w-0 truncate text-title font-semibold tracking-tight text-muted-foreground" title={item.title}>
          {item.title}
        </h1>
        <span className="flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground">
          <HarnessIcon harness={item.harness} tone="brand" className="size-4" />
          {HARNESS_NAME[item.harness]}
        </span>
        <span className="@container ml-auto flex shrink-0 items-center">
          <AddToTopicButton member={historyMember(item)} label={item.title} />
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-meta font-medium text-muted-foreground">
          Read-only{item.lastActiveAt !== null && <span className="font-normal opacity-70"> · {formatAge(now - item.lastActiveAt)}</span>}
        </span>
      </PaneHeader>
      <ShellCell row="body" className="flex flex-col overflow-hidden">
        <Chat
          key={key}
          sessionId={key}
          harness={item.harness}
          chat={chat}
          ended
          onEarlier={noEarlier}
          onPage={noop}
          onFollowing={noop}
        />
      </ShellCell>
      <ShellCell row="dock">
        {/* Like the ended banner: clamped to fit the resting dock, the full text in an overlay (SIDE-8.1). */}
        <DockNote role="note" icon={<CircleSlash className="size-4" aria-hidden />} title={noteTitle} detail={note} />
        {where && (
          <StatusBar role="group" aria-label="Where it ran" title={where}>
            {item.projectPath && <span className="min-w-0 truncate">{item.projectPath}</span>}
            {item.branch && (
              <>
                {item.projectPath && (
                  <span aria-hidden className="shrink-0 opacity-60">
                    ·
                  </span>
                )}
                <span className="flex min-w-0 items-center gap-1">
                  <GitBranch aria-label="Branch" className="size-3.5 shrink-0" />
                  <span className="truncate">{item.branch}</span>
                </span>
              </>
            )}
          </StatusBar>
        )}
      </ShellCell>
    </ShellView>
  );
}

/**
 * Which messages these are. tb-session 0.2 can't give the latest: its preview is the first 20,
 * and it's labelled as such rather than as the latest.
 */
function previewNote(detail: HistoryDetail): string {
  const from = detail.source === 'index' ? 'Its Transcript is gone: these come from what tb-session indexed earlier' : 'From its Transcript';
  if (detail.preview === 'latest') {
    return detail.source === 'index'
      ? 'Its Transcript is gone: these are the latest messages tb-session indexed earlier, prompts and replies only.'
      : 'Its latest messages from its Transcript, prompts and replies only.';
  }
  if (detail.preview === 'all') return `${from}: all its messages, prompts and replies only.`;
  const of = detail.totalMessages !== null ? ` of ${detail.totalMessages}` : '';
  return `${from}: its first messages${of}, prompts and replies only, not the latest. This tb-session (0.2) can't show the latest; update it to see them.`;
}
