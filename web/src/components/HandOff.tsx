import type { Status } from '@shared/types.ts';
import { ChevronDown, Reply } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SessionMarker } from '@/components/ui/session-marker';
import { StatusTag } from '@/components/ui/status-tag';
import { Textarea } from '@/components/ui/textarea';
import { ActionIcon } from '@/lib/actions';
import type { HandoffWait, ShownLink } from '@/lib/handoff';
import { STATUS_LABEL, STATUS_TAG_CLASS } from '@/lib/sessions';
import { cn } from '@/lib/utils';

/** HAND-1.1: why "Hand off…" waits, while the Session is Busy or Needs you. */
export const HAND_OFF_WAITS = 'Hand off… waits for the Session to be Idle.';
/** HAND-2.4: why "Try again" is disabled for a Session that ended with its wait. */
export const HAND_OFF_ENDED = 'The Session has ended.';
/** HAND-1.2: the field's placeholder (UX). */
export const PIECE_PLACEHOLDER = 'All of the work. Or name a piece of it: a bug found on the way, a follow-up, a second PR';

/** The dot on the button while the popover is closed (UX, "The button while it waits"). */
const WAIT_DOT: Record<HandoffWait['state'], string> = { sending: 'bg-busy', writing: 'bg-busy', ready: 'bg-ok', failed: 'bg-destructive' };

export interface HandOffProps {
  /** The Session's Status: "Hand off…" asks only while it's Idle (HAND-1.1). */
  status: Status;
  /** HAND-1.1: the Session ended while it had a wait: the wait still shows, but nothing is sent. */
  ended?: boolean;
  /** HAND-2: this Session's wait, as App keeps it; undefined for none. */
  wait: HandoffWait | undefined;
  open: boolean;
  /** A press of the button or `F` (HAND-1.4): opens the popover, or the launcher when the Handover is ready (HAND-2.3). */
  onPress(): void;
  onClose(): void;
  /** HAND-1.2: "Write Handover", and HAND-2.4's "Try again". */
  onWrite(piece: string): void;
  /** HAND-2.1: Cancel stops waiting; the Session's reply stays in its chat. */
  onCancel(): void;
}

/**
 * HAND-1, HAND-2: the Session header's first action, "Hand off…" (`Forward`), and its popover. At
 * rest the form; while the Session writes, "Writing the Handover…" with Cancel; after a failure, why,
 * with "Try again". Closing it while the Session writes keeps the wait (HAND-2.2): the button then
 * shows a dot, Busy's blue while it writes, `ok` once the Handover is ready, `destructive` if it failed.
 */
export function HandOffButton({ status, ended = false, wait, open, onPress, onClose, onWrite, onCancel }: HandOffProps) {
  const titleId = useId();
  // HAND-1.1: a request is sent only while the Session is Idle, from the form or "Try again".
  const blocked = ended ? HAND_OFF_ENDED : status !== 'idle' ? HAND_OFF_WAITS : null;
  const waits = !wait && status !== 'idle';
  const tip = waits
    ? HAND_OFF_WAITS
    : wait?.state === 'ready'
      ? 'The Handover is ready: open the launcher (F)'
      : wait?.state === 'failed'
        ? `Writing the Handover failed: ${wait.reason}`
        : wait
          ? 'Writing the Handover… (F)'
          : 'Hand off… (F)';
  return (
    <Popover open={open} onOpenChange={(next) => (next ? onPress() : onClose())}>
      <PopoverTrigger asChild>
        <IconButton
          size="md"
          label="Hand off…"
          tip={tip}
          aria-disabled={waits || undefined}
          data-action="hand-off"
          data-wait={wait?.state}
          // The trigger's own slot would replace the icon button's, which the header's guard reads (DS-18.5).
          data-slot="icon-button"
          className={cn('relative data-[state=open]:bg-accent data-[state=open]:text-accent-foreground', waits && 'cursor-default opacity-50 hover:bg-transparent')}
        >
          <ActionIcon id="hand-off" />
          {wait && !open && <span aria-hidden data-slot="wait-dot" className={cn('absolute top-1 right-1 size-1.5 rounded-full ring-2 ring-background', WAIT_DOT[wait.state])} />}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="flex w-[22.5rem] flex-col gap-2.5 p-3" data-testid="hand-off">
        <h2 id={titleId} className="text-body font-semibold">
          Hand off
        </h2>
        {!wait || wait.state === 'ready' ? (
          <PieceForm blocked={blocked} onWrite={onWrite} onCancel={onClose} />
        ) : wait.state === 'failed' ? (
          <>
            <Alert title={wait.reason} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!!blocked} title={blocked ?? undefined} onClick={() => onWrite(wait.piece)}>
                <ActionIcon id="retry" />
                Try again
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Loading label="Writing the Handover…" since={wait.sentAt} size="body" />
              <p className="text-meta text-muted-foreground" data-field="hand-off-piece">
                {wait.piece.trim() ? `The piece: ${wait.piece.trim()}. ` : ''}The launcher opens when the Session is Idle again.
              </p>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * HAND-1.2: "What to hand off", optional; Enter writes, Shift+Enter starts a new line. `blocked`: why
 * nothing can be sent now (HAND-1.1: the Session left Idle while the form was open), else null.
 */
function PieceForm({ blocked, onWrite, onCancel }: { blocked: string | null; onWrite(piece: string): void; onCancel(): void }) {
  const [piece, setPiece] = useState('');
  const fieldId = useId();
  const write = () => {
    if (!blocked) onWrite(piece);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    write();
  };
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        write();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-meta font-medium text-muted-foreground">
          What to hand off
        </label>
        <Textarea id={fieldId} rows={3} value={piece} placeholder={PIECE_PLACEHOLDER} onChange={(e) => setPiece(e.target.value)} onKeyDown={onKeyDown} className="min-h-0 resize-none text-body" />
        <p className="text-meta text-muted-foreground" data-field="hand-off-note">
          {blocked ?? 'The Session writes a Handover; the launcher opens with it, for you to read and start.'}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!!blocked} title={blocked ?? undefined}>
          Write Handover
          <Kbd className="border-current/30 opacity-70">Enter</Kbd>
        </Button>
      </div>
    </form>
  );
}

/**
 * HAND-4.1, HAND-4.2: after the Harness in the header, quiet links in `meta` grey: "from <old title>"
 * in a Session started from a Handover; "Continued in <title>", or "Continued in N Sessions" with a
 * menu of them, in the old one. Below 32rem of header a link is its icon alone, its words its tooltip.
 */
export function HandoffLinks({ from, into, onOpen }: { from: ShownLink | null; into: readonly ShownLink[]; onOpen(link: ShownLink): void }) {
  if (!from && !into.length) return null;
  return (
    <>
      {from && (
        <Button
          variant="quiet"
          size="line"
          className="min-w-0 shrink"
          aria-label={`Continued from ${from.title}`}
          title={`Continued from ${from.title}`}
          data-field="continued-from"
          onClick={() => onOpen(from)}
        >
          <Reply aria-hidden />
          <span className="min-w-0 truncate @max-[32rem]:sr-only">from {from.title}</span>
        </Button>
      )}
      {into.length === 1 && (
        <Button
          variant="quiet"
          size="line"
          className="min-w-0 shrink"
          title={`Continued in ${into[0]!.title}`}
          data-field="continued-in"
          onClick={() => onOpen(into[0]!)}
        >
          <ActionIcon id="hand-off" />
          <span className="min-w-0 truncate @max-[32rem]:sr-only">Continued in {into[0]!.title}</span>
        </Button>
      )}
      {into.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="quiet" size="line" className="min-w-0 shrink" title={`Continued in ${into.length} Sessions`} data-field="continued-in">
              <ActionIcon id="hand-off" />
              <span className="min-w-0 truncate @max-[32rem]:sr-only">Continued in {into.length} Sessions</span>
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" aria-label="Continued in" className="w-80">
            {into.map((link) => (
              <DropdownMenuItem key={link.sessionId} onSelect={() => onOpen(link)}>
                <SessionMarker state={link.live ? 'live' : 'past'} status={link.live?.status} since={link.live?.statusSince} />
                <span className="min-w-0 flex-1 truncate">{link.title}</span>
                <StatusTag className={link.live ? STATUS_TAG_CLASS[link.live.status] : 'bg-muted text-muted-foreground'}>{link.live ? STATUS_LABEL[link.live.status] : 'Ended'}</StatusTag>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
