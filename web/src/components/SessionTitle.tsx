import { checkName } from '@shared/rename.ts';
import type { RenameResult, SessionRow } from '@shared/types.ts';
import { Pencil } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RENAME_NOT_SHOWN, RENAME_SETTLE_MS, renameFailure, renaming } from '@/lib/rename';
import { cn } from '@/lib/utils';

/** What the header's title is doing (VIEW-5.12–5.14). `width` is the title's, which the field takes. */
type Phase =
  /** `refocus`: the field went away under the keyboard, so focus goes back to the title. */
  | { kind: 'rest'; refocus?: boolean }
  | { kind: 'editing'; draft: string; width: number }
  /** The request is out; `from` is the title it started from, `op` the rename it is. */
  | { kind: 'renaming'; op: number; from: string; width: number }
  /** Fleet typed it; the list hasn't shown a new title yet. */
  | { kind: 'confirming'; op: number; from: string; width: number; until: number };

const REST: Phase = { kind: 'rest' };

/**
 * The phase and the note change together, so a rename's answer is only ever read against the phase
 * it belongs to: once that rename is no longer the current one (its title already read back, or a
 * new edit started), its result and its error change nothing.
 */
interface TitleState {
  phase: Phase;
  note: Omit<TitleNote, 'id'> | null;
}

/** VIEW-5.12: line breaks in a pasted name, a run of them as one, become a space. */
const PASTED_BREAKS = /[\r\n\u2028\u2029]+/g;

/** An element that shows another Session (a live or past one's row, a start's): going there cancels an edit. */
const OTHER_SESSION = '[data-session-id],[data-launch-id]';

/** What shows beside the title, where Stop's error does. */
export interface TitleNote {
  /** For the field's `aria-describedby`. */
  id: string;
  message: string;
  /** `error`: the rename failed, or the name can't be sent; `info`: sent, but not shown yet. */
  tone: 'error' | 'info';
}

/** Nothing is focused: the field that had it is gone. Only then does focus go back to the title. */
const focusLost = () => document.activeElement === null || document.activeElement === document.body;

/**
 * VIEW-5.12–5.14: the header's title, renamed in place. At rest it's the title, in a button that
 * looks like it when the Session can be renamed (a pencil on hover or keyboard focus, "Rename" its
 * tooltip); a click or Enter opens a field as wide as the title, the whole name selected. Enter or
 * leaving the field saves, Esc puts the title back. While Fleet works the field reads "Renaming…",
 * disabled, until the list shows a new title, or for 5 s after Fleet's answer. The view is mounted
 * per Session, so this state is that Session's own.
 *
 * Returns the title, which goes where the header's `h1` goes, and the note to show beside it (why
 * it failed, why the name can't be sent, or that it was sent but doesn't show yet).
 */
export function useSessionTitle({
  row,
  ended,
  now,
  onRename,
  headingRef,
}: {
  row: SessionRow;
  ended: boolean;
  now: number;
  onRename(row: SessionRow, name: string): Promise<RenameResult>;
  /** The header's title, where End Session puts focus once its button is gone. */
  headingRef: RefObject<HTMLHeadingElement | null>;
}): { title: ReactNode; note: TitleNote | null } {
  const [{ phase, note }, setState] = useState<TitleState>({ phase: REST, note: null });
  const setPhase = (next: Phase) => setState((s) => ({ ...s, phase: next }));
  const setNote = (next: TitleState['note']) => setState((s) => ({ ...s, note: next }));
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Numbers each rename, so an answer is matched to the rename that asked. */
  const ops = useRef(0);
  /** Where the caret goes after a paste the field took over, once the draft is rendered. */
  const caret = useRef<number | null>(null);
  /** The field is closing (Enter, Esc, a save under way): the blur that follows isn't a save. */
  const closing = useRef(false);
  /** Put focus back on the title once it's back, if nothing else took it meanwhile. */
  const refocus = useRef(false);
  const noteId = useId();
  const can = renaming(row, ended);

  // VIEW-5.14: the list shows a new title (the name, or what the Harness made of it): done. Or 5 s
  // after Fleet's answer it still doesn't: say the name was sent but doesn't show yet.
  // Either way that rename is over: an answer or an error that comes for it later changes nothing.
  if ((phase.kind === 'renaming' || phase.kind === 'confirming') && row.title !== phase.from) {
    setState({ phase: REST, note });
  } else if (phase.kind === 'confirming' && now >= phase.until) {
    setState({ phase: REST, note: { message: RENAME_NOT_SHOWN, tone: 'info' } });
  }

  // VIEW-5.13: an edit lasts only while the Session can be renamed: once it's Busy, Needs you, its
  // Status unknown, View only or ended, it's cancelled. The field is gone from this very render, so
  // neither Enter nor leaving it can save, and React drops the blur its removal causes; the plain
  // title shows, its tooltip says why.
  if (phase.kind === 'editing' && !can.can) setState({ phase: { kind: 'rest', refocus: true }, note: null });

  const editing = phase.kind === 'editing' && can.can;
  const pending = (phase.kind === 'renaming' || phase.kind === 'confirming') && !ended;

  // The field opens focused, the whole name selected.
  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  useLayoutEffect(() => {
    if (phase.kind !== 'rest' || !(refocus.current || phase.refocus)) return;
    refocus.current = false;
    if (focusLost()) (button.current ?? headingRef.current)?.focus();
  }, [phase, headingRef]);
  // Going to another Session (its row, a past one, a start) cancels the edit: the pointer press that
  // takes focus there would otherwise save on the way out.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      const other = e.target instanceof Element ? e.target.closest(OTHER_SESSION) : null;
      if (!other || other.getAttribute('data-session-id') === row.id) return;
      closing.current = true;
      setState((s) => (s.phase.kind === 'editing' ? { phase: REST, note: null } : s));
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, row.id]);
  // A paste the field took over: the caret goes after what was pasted, not to the end.
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [phase]);

  const start = () => {
    // The title's width, so the field takes its place without moving the line.
    const width = button.current?.getBoundingClientRect().width ?? 0;
    closing.current = false;
    // A new edit: the rename before it, if it's still out, is no longer the current one.
    setState({ phase: { kind: 'editing', draft: row.title, width }, note: null });
  };

  const cancel = (refocusTitle: boolean) => {
    closing.current = true;
    refocus.current = refocusTitle;
    setPhase(REST);
  };

  const save = async (draft: string, width: number, fromKey: boolean) => {
    // Empty or unchanged: nothing to rename.
    if (draft.trim() === '' || draft.trim() === row.title) return cancel(fromKey);
    const checked = checkName(draft);
    if (!checked.ok) {
      setNote({ message: checked.message, tone: 'error' });
      return;
    }
    closing.current = true;
    refocus.current = fromKey;
    const from = row.title;
    const op = ++ops.current;
    setState({ phase: { kind: 'renaming', op, from, width }, note: null });
    const current = (s: TitleState) => s.phase.kind === 'renaming' && s.phase.op === op;
    try {
      await onRename(row, checked.name);
      // Still the old title: wait for the list (the server polls it at once, and every 2 s anyway).
      const until = Date.now() + RENAME_SETTLE_MS;
      setState((s) => (current(s) ? { ...s, phase: { kind: 'confirming', op, from, width, until } } : s));
    } catch (err) {
      // Nothing is retried: the old title stays, and why shows beside it.
      const message = renameFailure(err);
      setState((s) => (current(s) ? { phase: REST, note: { message, tone: 'error' } } : s));
    }
  };

  // VIEW-5.12: the field is one line, and the browser would drop a pasted line break without a
  // trace (`foo` and `bar` run together); Claude Code turns one into a space, and so does this.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text/plain');
    const text = pasted.replace(PASTED_BREAKS, ' ');
    if (text === pasted) return;
    e.preventDefault();
    const el = e.currentTarget;
    const startAt = el.selectionStart ?? el.value.length;
    const draft = el.value.slice(0, startAt) + text + el.value.slice(el.selectionEnd ?? startAt);
    caret.current = startAt + text.length;
    setState((s) => (s.phase.kind === 'editing' ? { ...s, phase: { ...s.phase, draft } } : s));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (phase.kind !== 'editing' || e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void save(e.currentTarget.value, phase.width, true);
    } else if (e.key === 'Escape') {
      // Esc here only cancels: it never reaches the page's shortcuts.
      e.preventDefault();
      e.stopPropagation();
      setNote(null);
      cancel(true);
    }
  };

  let content: ReactNode = row.title;
  if (editing || pending) {
    const width = phase.width;
    content = (
      <input
        ref={input}
        aria-label="Session name"
        aria-invalid={editing && note?.tone === 'error' ? true : undefined}
        aria-describedby={editing && note ? noteId : undefined}
        data-slot="title-field"
        disabled={pending}
        value={phase.kind === 'editing' && !pending ? phase.draft : 'Renaming…'}
        spellCheck={false}
        autoComplete="off"
        // The title's width, at least 8rem; it gives way like the title on a narrow header.
        style={{ width: `max(8rem, ${width}px)` }}
        className="h-7 max-w-full min-w-0 rounded-sm border border-input bg-background px-1 text-title font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:text-muted-foreground"
        onChange={(e) => {
          const draft = e.currentTarget.value;
          setState((s) => (s.phase.kind === 'editing' ? { ...s, phase: { ...s.phase, draft } } : s));
        }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (closing.current || phase.kind !== 'editing') return;
          void save(e.currentTarget.value, phase.width, false);
        }}
      />
    );
  } else if (can.can) {
    content = (
      <button
        ref={button}
        type="button"
        title={note ? `Rename\n${note.message}` : 'Rename'}
        data-slot="title-rename"
        className="group/title flex max-w-full min-w-0 cursor-text items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={start}
      >
        <span className="min-w-0 truncate">{row.title}</span>
        <Pencil
          aria-hidden
          data-slot="title-pencil"
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
        />
      </button>
    );
  }

  // A title that can't be renamed: its tooltip is the whole title, and for a live Session why not.
  const tooltip = editing || pending || can.can ? undefined : can.why ? `${row.title}\n${can.why}` : row.title;
  return {
    title: (
      <h1
        ref={headingRef}
        tabIndex={-1}
        className={cn('min-w-5 truncate text-title font-semibold tracking-tight outline-none', ended && 'text-muted-foreground')}
        title={tooltip}
      >
        {content}
      </h1>
    ),
    note: note && { ...note, id: noteId },
  };
}
