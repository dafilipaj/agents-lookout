import type { ChatQuestion, QuestionAnswer } from '@shared/types.ts';
import { Circle, CircleDot, ShieldQuestion, Square, SquareCheck, TerminalSquare } from 'lucide-react';
import { type ComponentPropsWithoutRef, type HTMLAttributes, type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  type Draft,
  type DraftKeeper,
  type PermissionPanel,
  type QuestionPanel,
  type TerminalLink,
  answersOnClick,
  draftAnswers,
  emptyDraft,
  hasPreviews,
  pick,
  shownOption,
  typeText,
} from '@/lib/answers';
import type { QuestionEntry } from '@/lib/chat';
import { linkify } from '@/lib/links';
import { cn } from '@/lib/utils';

/** VIEW-1.9: a box for several picks, a circle for one; checked, or with a dot, when picked. */
export function ChoiceIcon({ multiSelect, chosen }: { multiSelect: boolean; chosen: boolean }) {
  const Icon = multiSelect ? (chosen ? SquareCheck : Square) : chosen ? CircleDot : Circle;
  return <Icon className={cn('size-3.5', chosen && 'text-primary')} />;
}

/**
 * VIEW-10.1: the option under the pointer and the one with focus, for the preview box to follow.
 * `on(i)` goes on option `i`'s row: pointer events reach the row even while its button is locked
 * (`pointer-events: none`), and focus events bubble up from the button. Entering or focusing a row
 * sets it; leaving is decided on the whole options-and-box area (`area`), so the option shown stays
 * while the pointer or focus is anywhere in it, the box included, and falls back only when it
 * leaves.
 */
function usePreviewFollow() {
  const [pointer, setPointer] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const on = useCallback(
    (i: number): OptionRowProps => ({
      onPointerEnter: () => setPointer(i),
      onFocus: () => setFocus(i),
    }),
    [],
  );
  const area: Pick<HTMLAttributes<HTMLElement>, 'onPointerLeave' | 'onBlur'> = {
    onPointerLeave: () => setPointer(null),
    onBlur: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setFocus(null);
    },
  };
  return { pointer, focus, on, area };
}

/** VIEW-10.1: what an option's row takes so the preview box follows the pointer and focus. */
export type OptionRowProps = Pick<HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onFocus'>;

/**
 * VIEW-10.1: a question's options with its preview box beside them, the box showing the option
 * under the pointer, else the one with focus, else the picked one, else the first (`shownOption`).
 * The options are the caller's (`children`): each row takes `row(i)`, and `shown` is the option the
 * box shows, `followed` whether the pointer or focus put it there (it then has the hover look).
 */
export function PreviewOptions({
  question,
  picked,
  children,
}: {
  question: ChatQuestion;
  picked: Iterable<number>;
  children(row: (i: number) => OptionRowProps, shown: number, followed: boolean): ReactNode;
}) {
  const { pointer, focus, on, area } = usePreviewFollow();
  const shown = Math.min(shownOption(pointer, focus, picked), question.options.length - 1);
  return <WithPreview area={area} options={children(on, shown, pointer !== null || focus !== null)} box={<PreviewBox option={question.options[shown]!} />} />;
}

/**
 * VIEW-10.2, 10.7: one option's preview, as the Transcript has it: a plain `pre` in the chat's code
 * look (VIEW-1.14's block), never wrapped, rendered or linked, at most 24 lines tall before it
 * scrolls, sideways too, inside itself. A region named after the option; not a live region, so
 * moving between options isn't announced. It takes focus only while it scrolls (measured as it
 * resizes and as the preview changes), so the keyboard can scroll it; one that fits is no tab stop.
 */
export function PreviewBox({ option }: { option: ChatQuestion['options'][number] }) {
  const ref = useRef<HTMLPreElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const [focused, setFocused] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setScrolls(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
  }, []);
  useLayoutEffect(measure, [measure, option.preview, option.previewTooLong]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div className="min-w-0" data-field="preview">
      {/* The region's name says the label; this is its look, not a second announcement. */}
      <p aria-hidden className="mb-1 truncate text-caption text-muted-foreground">
        {option.label}
      </p>
      <pre
        ref={ref}
        role="region"
        aria-label={`Preview: ${option.label}`}
        tabIndex={scrolls || focused ? 0 : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          'max-h-[calc(24lh_+_1.25rem_+_2px)] overflow-auto rounded-md border border-border bg-muted/60 px-3 py-2.5 font-mono text-meta leading-[1.55] whitespace-pre outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-black/25',
          option.preview === undefined && 'text-muted-foreground',
        )}
      >
        {option.preview ?? (option.previewTooLong ? 'This preview is too long to show here.' : 'No preview')}
      </pre>
    </div>
  );
}

/**
 * VIEW-10.1: a question's options with its preview box beside them, the options in a column of at
 * most 20rem and the box in the rest of the card, their tops level; under the options, full width,
 * when the card is narrower than 36rem (a container query on the card, as the rail's on the chat).
 */
function WithPreview({ options, box, area }: { options: ReactNode; box: ReactNode; area: Pick<HTMLAttributes<HTMLElement>, 'onPointerLeave' | 'onBlur'> }) {
  return (
    <div className="mt-1.5 flex flex-col gap-2 @min-[36rem]:flex-row @min-[36rem]:items-start @min-[36rem]:gap-3" data-field="with-preview" {...area}>
      <div className="min-w-0 @min-[36rem]:w-80 @min-[36rem]:shrink-0">{options}</div>
      <div className="min-w-0 @min-[36rem]:flex-1">{box}</div>
    </div>
  );
}

/**
 * VIEW-4.3: why Lookout won't answer, in place of the buttons, and the way to the terminal. It's a
 * live region, so the reason is announced when it replaces the buttons.
 */
export function AnswerInTerminal({ message, terminal }: { message: string; terminal: TerminalLink }) {
  return <TerminalNote message={message} terminal={terminal} data-answer="blocked" />;
}

/**
 * One line saying in plain words why to look at the terminal, with "Show terminal" while the
 * Terminal preview is closed: for an answer (VIEW-4.3), and under a message that never reached the
 * Transcript (VIEW-1.13). A live region, so it's announced when it shows: an alert, or with `info`
 * (nothing went wrong, as for a slash command whose result shows only there) a polite status in
 * muted text.
 */
export function TerminalNote({
  message,
  terminal,
  info = false,
  className,
  ...rest
}: { message: string; terminal: TerminalLink | null; info?: boolean } & Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'role'>) {
  return (
    <div
      role={info ? 'status' : 'alert'}
      className={cn('mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta', info ? 'text-muted-foreground' : 'text-needs-you-text', className)}
      {...rest}
    >
      <span className="min-w-0">{message}</span>
      {terminal && !terminal.open && (
        <Button variant="outline" size="xs" className="h-6 gap-1 text-meta" onClick={terminal.show}>
          <TerminalSquare className="size-3" />
          Show terminal
        </Button>
      )}
    </div>
  );
}

/**
 * VIEW-4.1: a pending question's options as buttons. One question with one choice answers on
 * click; several questions, a multi-select one, or a typed answer are picked, then submitted.
 * "Type something" works as in the terminal: with one choice it replaces the option, with several
 * it joins them. VIEW-4.6: what's picked and typed is kept in `kept` (App's, for this Session, by
 * question id), so a form a read or a Session switch took away comes back as it was. VIEW-4.7:
 * while it waits for a read (`reading`) it's locked with `aria-disabled`, not `disabled`, so focus
 * stays put rather than dropping to the page, where `j`/`k` switch Sessions.
 */
export function QuestionForm({
  entry,
  panel,
  onSubmit,
  kept,
}: {
  entry: QuestionEntry;
  panel: QuestionPanel;
  onSubmit(answers: QuestionAnswer[]): void;
  kept?: DraftKeeper;
}) {
  const questions = entry.questions;
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => kept?.get(entry.id) ?? questions.map(() => emptyDraft));
  useEffect(() => {
    kept?.set(entry.id, drafts);
  }, [kept, entry.id, drafts]);
  const oneClick = answersOnClick(questions);
  const locked = panel.phase !== 'ready';
  // Locked, but focusable: what has focus keeps it, and clicks and Enter do nothing.
  const waiting = panel.phase === 'reading';
  const answers = draftAnswers(questions, drafts);
  const typed = drafts.some((d) => d.text.trim() !== '');
  const withSubmit = !oneClick || typed;
  const progress = panel.phase === 'sending' ? 'Answering…' : panel.phase === 'sent' ? 'Sent. Waiting for the Session…' : '';
  const update = (i: number, d: Draft) => setDrafts((all) => all.map((x, k) => (k === i ? d : x)));
  const submit = () => {
    if (!locked && answers) onSubmit(answers);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  /**
   * One question's options as buttons. With previews (VIEW-10.1), each row tells the box where the
   * pointer and focus are, and the option the box shows for them has the hover look; a pick keeps
   * its own.
   */
  const optionList = (q: ChatQuestion, qi: number, d: Draft, preview?: { row: (i: number) => OptionRowProps; shown: number; followed: boolean }) => (
    <ul className={cn('space-y-1', !preview && 'mt-1.5')}>
      {q.options.map((o, oi) => {
        const chosen = d.picked.includes(oi);
        const hovered = !!preview && preview.followed && preview.shown === oi && !chosen;
        return (
          <li key={oi} {...preview?.row(oi)}>
            <button
              type="button"
              // A toggle while picks are submitted later; a plain button when the click answers.
              aria-pressed={oneClick ? undefined : chosen}
              disabled={locked && !waiting}
              aria-disabled={waiting || undefined}
              data-picked={chosen || undefined}
              data-shown={(preview && preview.shown === oi) || undefined}
              onClick={() => {
                if (locked) return;
                if (oneClick) {
                  update(qi, pick(q, emptyDraft, oi));
                  onSubmit([{ options: [oi] }]);
                } else update(qi, pick(q, d, oi));
              }}
              className={cn(
                'flex w-full gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-body transition-colors outline-none',
                'hover:border-foreground/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60',
                chosen ? 'border-primary hover:border-primary bg-accent font-medium' : hovered ? 'border-foreground/40 bg-accent' : 'border-border',
              )}
            >
              <span aria-hidden className="flex h-[1lh] w-3.5 shrink-0 items-center justify-center text-muted-foreground" data-field="choice">
                <ChoiceIcon multiSelect={q.multiSelect} chosen={chosen} />
              </span>
              {/* VIEW-1.12: plain text, never a link inside a button. */}
              <span className="min-w-0">
                {o.label}
                {o.description && <span className="block text-meta font-normal text-muted-foreground">{o.description}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div data-answer={panel.phase}>
      <div className="space-y-3">
        {questions.map((q, qi) => {
          const d = drafts[qi] ?? emptyDraft;
          const name = q.header || q.question;
          return (
            <section key={qi} aria-label={name}>
              {q.header && <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">{linkify(q.header)}</p>}
              <p className="text-prose font-medium">{linkify(q.question)}</p>
              {q.multiSelect && <p className="text-meta text-muted-foreground">Several can be picked</p>}
              {hasPreviews(q) ? (
                // VIEW-10.1, 10.3: the box beside the options; a click picks, Submit answers; no field.
                <PreviewOptions question={q} picked={d.picked}>
                  {(row, shown, followed) => optionList(q, qi, d, { row, shown, followed })}
                </PreviewOptions>
              ) : (
                <>
                  {optionList(q, qi, d)}
                  <input
                    type="text"
                    aria-label={`Type something: ${name}`}
                    placeholder="Type something…"
                    maxLength={2000}
                    disabled={locked && !waiting}
                    readOnly={waiting}
                    aria-disabled={waiting || undefined}
                    value={d.text}
                    onChange={(e) => update(qi, typeText(q, d, e.target.value))}
                    onKeyDown={onKeyDown}
                    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2.5 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-60 aria-disabled:opacity-60 dark:bg-input/20"
                  />
                </>
              )}
            </section>
          );
        })}
      </div>
      {/* VIEW-4.1: why the server couldn't take the last answer as written; the text stays to fix. */}
      {panel.phase === 'ready' && panel.message && (
        <Alert layout="inline" title={panel.message} className="mt-2" />
      )}
      {/* No row at all while a one-click question waits: only Submit or the progress needs one. The
          live region stays mounted, empty, so its first change is announced. */}
      <div className={cn('flex items-center gap-3', (withSubmit || progress) && 'mt-2.5 min-h-7')} data-slot="answer-actions">
        {withSubmit && (
          <Button
            size="sm"
            className="h-7 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            disabled={(locked && !waiting) || !answers}
            aria-disabled={(waiting && !!answers) || undefined}
            onClick={submit}
          >
            {panel.phase === 'sending' ? 'Sending…' : 'Submit'}
          </Button>
        )}
        <p role="status" className="text-meta text-muted-foreground">
          {progress}
        </p>
      </div>
    </div>
  );
}

/**
 * VIEW-4.2: the permission prompt on the Session's terminal, at the bottom of the chat: what it
 * asks, and its choices as buttons with the terminal's wording. When Lookout won't answer it, why,
 * in place of the buttons (VIEW-4.3).
 */
export function PromptCard({ panel, label, onChoose, terminal }: { panel: PermissionPanel; label: string; onChoose(n: number): void; terminal: TerminalLink }) {
  const p = panel.prompt;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-3">
      <section aria-label="Permission prompt" data-kind="permission" className="rounded-lg border border-needs-you/60 bg-needs-you-soft px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-meta text-muted-foreground">
          <ShieldQuestion className="size-3.5" />
          <span className="font-medium text-foreground/80">{label} asks</span>
          <span className="ml-auto font-medium text-needs-you-text">Waiting for your answer</span>
        </p>
        {p ? (
          <>
            {p.title && <p className="text-prose font-medium">{p.title}</p>}
            {p.detail.some((l) => l.trim() !== '') && (
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-background/70 px-2.5 py-1.5 font-mono text-meta leading-[1.45] whitespace-pre-wrap break-words dark:bg-black/25">
                {p.detail.join('\n')}
              </pre>
            )}
          </>
        ) : (
          <p className="text-prose font-medium">A permission prompt is waiting in the terminal</p>
        )}
        {panel.kind === 'buttons' ? (
          <div className="mt-2.5 flex flex-col items-start gap-1.5" role="group" aria-label="Choices">
            {panel.prompt.choices.map((c) => (
              <Button
                key={c.n}
                variant="outline"
                size="sm"
                disabled={panel.sending}
                onClick={() => onChoose(c.n)}
                className="h-auto min-h-8 max-w-full justify-start py-1.5 text-left text-body font-normal whitespace-normal"
              >
                <span aria-hidden className="font-mono text-meta text-muted-foreground">
                  {c.n}
                </span>
                {c.label}
              </Button>
            ))}
            {panel.sending && (
              <p role="status" className="text-meta text-muted-foreground">
                Answering…
              </p>
            )}
          </div>
        ) : (
          <AnswerInTerminal message={panel.message} terminal={terminal} />
        )}
      </section>
    </div>
  );
}
