import type { QuestionAnswer } from '@shared/types.ts';
import { Circle, CircleDot, ShieldQuestion, Square, SquareCheck, TerminalSquare } from 'lucide-react';
import { type ComponentPropsWithoutRef, type KeyboardEvent, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { type Draft, type DraftKeeper, type PermissionPanel, type QuestionPanel, type TerminalLink, answersOnClick, draftAnswers, emptyDraft, pick, typeText } from '@/lib/answers';
import type { QuestionEntry } from '@/lib/chat';
import { linkify } from '@/lib/links';
import { cn } from '@/lib/utils';

/** VIEW-1.9: a box for several picks, a circle for one; checked, or with a dot, when picked. */
export function ChoiceIcon({ multiSelect, chosen }: { multiSelect: boolean; chosen: boolean }) {
  const Icon = multiSelect ? (chosen ? SquareCheck : Square) : chosen ? CircleDot : Circle;
  return <Icon className="size-3.5" />;
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
              <ul className="mt-1.5 space-y-1">
                {q.options.map((o, oi) => {
                  const chosen = d.picked.includes(oi);
                  return (
                    <li key={oi}>
                      <button
                        type="button"
                        // A toggle while picks are submitted later; a plain button when the click answers.
                        aria-pressed={oneClick ? undefined : chosen}
                        disabled={locked && !waiting}
                        aria-disabled={waiting || undefined}
                        data-picked={chosen || undefined}
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
                          chosen ? 'border-foreground/40 bg-accent font-medium' : 'border-border',
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
