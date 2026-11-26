import type { LaunchChoices, Settings } from '@shared/settings.ts';
import type { LaunchRequest } from '@shared/types.ts';
import { type Topic, sortTopics, topicPrompt } from '@shared/topics.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SaveError } from '@/lib/client';
import { useCommandList } from '@/lib/command-list';
import type { ComposerCommands } from '@/lib/commands';
import { type HarnessState, type LaunchDraft, topicFill } from '@/lib/launch';
import { launchFields, pickChoices, pickHarness, pickModel, shownPick } from '@/lib/launch-fields';
import { CommandsPopover } from './Commands';
import { DirectoryField, FIELD_GRID, HarnessField, ModelField, SkipPermissionsField } from './LaunchFields';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  draft: LaunchDraft;
  onDraftChange(draft: LaunchDraft): void;
  settings: Settings;
  harnesses: HarnessState;
  /** USAGE-3.1: a Harness at 95% or more of a window says so next to its name. */
  usage: UsageSnapshot | null;
  now: number;
  /** Starts the Session; throws with a message for people when it fails. */
  onStart(req: LaunchRequest): Promise<void>;
  /** Where focus goes when it closes: prevent the event to place it yourself. It has no Trigger to return to. */
  onCloseAutoFocus?(e: Event): void;
  /** TOPIC-5.3: the Topics a Session can be started in; the field shows only while there's one to pick. */
  topics?: readonly Topic[];
  /** TOPIC-15.4, TOPIC-17.6: a Topic's prompt, from what the tab holds when it's picked. */
  promptFor?(topic: Topic): string;
  /** LAUNCH-1.3: false for a launcher opened from Work or a Topic view, whose draft goes when it closes. */
  keepsInput?: boolean;
  /**
   * HAND-6: a launcher holding a ready Handover, its fields kept with it: titled "Hand off from <old
   * title>" (HAND-6.5), with "Discard Handover" (HAND-6.2) and "Keep in Topic" (TOPIC-15.7), which
   * throws with a message for people when it's refused.
   */
  handover?: { onDiscard(): void; onKeepInTopic(topicId: string, prompt: string): Promise<void> };
  /** LAUNCH-8: the `/` lists the tab has read; without it the prompt field has no list. */
  commands?: ComposerCommands;
}

/** The launcher (LAUNCH-1 … LAUNCH-4). */
export function Launcher({ open, onOpenChange, draft, onDraftChange, settings, harnesses, usage, now, onStart, onCloseAutoFocus, topics = [], promptFor = topicPrompt, keepsInput = true, handover, commands }: Props) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [keeping, setKeeping] = useState(false);
  // HAND-6.5: a Handover's launcher says whose work it carries on.
  const title = handover && draft.continues ? `Hand off from ${draft.continues.title}` : 'New Session';
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  // HAND-3.4: a start from a Handover lists the old Session's directory first; the server checks it again.
  const handoffDirectory = draft.continues?.directory || null;
  // LAUNCH-2.1, LAUNCH-3: what the fields show, by the rules they share with the Bot dialog (BOT-2.1).
  const fields = launchFields(draft, settings, harnesses, handoffDirectory);
  const { installed, harness, model, levels, effort, skipPermissions, directory } = fields;
  // TOPIC-5.3: Open Topics, most recently changed first; a Topic view's own Topic stays listed if it
  // was archived since. One deleted since stays picked and is sent, so the start is refused with why.
  const topicChoices = sortTopics(topics.filter((t) => t.state === 'open' || (draft.fromTopicView && t.id === draft.topic?.id)));
  const topicGone = draft.topic !== undefined && !topics.some((t) => t.id === draft.topic!.id);
  const topic = draft.topic && (topicGone || topicChoices.some((t) => t.id === draft.topic!.id)) ? draft.topic : undefined;
  const canStart = !submitting && harnesses.state === 'ready' && installed(harness) && directory !== '';

  // LAUNCH-8.1: the prompt's `/` list, for the Harness and start directory chosen; a Handover's
  // start names the Session it continues, whose directory the server checks (LAUNCH-8.4).
  const slash = useCommandList({
    store: commands,
    source: open && directory !== '' ? { harness, directory, continues: draft.continues ? { sessionId: draft.continues.sessionId, harness: draft.continues.harness } : null } : null,
    text: draft.prompt,
    field: promptRef,
    enterSendsWhole: false,
  });

  const set = (patch: Partial<LaunchDraft>) => {
    onDraftChange({ ...draft, ...shownPick(draft, fields), ...patch });
    setError(null);
  };

  // TOPIC-5.3: a Topic picked here is "started from this Topic" (TOPIC-5.2), whichever launcher it is.
  // TOPIC-15.4: in the launcher opened with N, ⌘N or "+", it brings the Topic's prompt too; one
  // opened from a Topic view, a Task, a Review or a Handover keeps its prompt.
  const pickTopic = (id: string) => {
    const next = id ? { id, via: id === draft.topic?.id ? draft.topic.via : ('topic' as const) } : undefined;
    const picked = id ? (topics.find((t) => t.id === id) ?? null) : null;
    const fill = keepsInput ? topicFill(draft.prompt, draft.topicText, picked ? promptFor(picked) : null) : null;
    set({ topic: next, ...(fill ?? {}) });
  };

  const setChoices = (patch: Partial<LaunchChoices>) => set(pickChoices(draft, fields, patch));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canStart) return;
    setSubmitting(true);
    setError(null);
    try {
      const continues = draft.continues && { sessionId: draft.continues.sessionId, harness: draft.continues.harness, title: draft.continues.title, piece: draft.continues.piece ?? '' };
      await onStart({ directory, harness, model, name: draft.name, prompt: draft.prompt, ...(levels.length && effort ? { effort } : {}), skipPermissions, ...(topic ? { topic } : {}), ...(continues ? { continues } : {}) });
    } catch (err) {
      // LAUNCH-4.4: stay open, show why, keep everything.
      setError({
        message: err instanceof Error ? err.message : 'Starting failed.',
        field: err instanceof SaveError ? err.field : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // TOPIC-15.7: kept in the picked Topic without a start; a refusal stays here, with everything.
  const keep = async () => {
    if (!handover || !topic || keeping) return;
    setKeeping(true);
    setError(null);
    try {
      await handover.onKeepInTopic(topic.id, draft.prompt);
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Keeping the Handover failed.', field: null });
    } finally {
      setKeeping(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          promptRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form onSubmit={submit} onKeyDown={onKeyDown} aria-label={title}>
          <div className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-title" title={handover ? title : undefined}>
                {title}
              </DialogTitle>
              <DialogDescription className="text-meta">Runs in its own Session host, so Lookout can control it.</DialogDescription>
            </div>
            {/* HAND-6.2: away from Start; the text stays in the old Session's chat. */}
            {handover && (
              <Button type="button" variant="danger" size="line" onClick={handover.onDiscard}>
                Discard Handover
              </Button>
            )}
          </div>

          <div className={FIELD_GRID}>
            <DirectoryField
              id="launch-directory"
              value={directory}
              directories={settings.startDirectories}
              own={handoffDirectory !== null ? { directory: handoffDirectory, label: `${handoffDirectory} · from ${draft.continues!.title}` } : null}
              onChange={(next) => set({ directory: next })}
            />
            <HarnessField labelId="launch-harness-label" name="harness" fields={fields} usage={usage} now={now} onChange={(id) => set(pickHarness(id))} />
            <ModelField id="launch" fields={fields} effortInvalid={error?.field === 'effort'} onModel={(id) => set(pickModel(draft, fields, id))} onEffort={(next) => setChoices({ effort: next })} />
            <SkipPermissionsField noteId="launch-skip-note" fields={fields} onChange={(next) => setChoices({ skipPermissions: next })} />

            <label htmlFor="launch-name" className="text-muted-foreground">
              Name
            </label>
            <Input
              id="launch-name"
              placeholder="optional"
              value={draft.name}
              maxLength={80}
              autoComplete="off"
              aria-invalid={error?.field === 'name' || undefined}
              onChange={(e) => set({ name: e.target.value })}
              className="h-8 text-body"
            />

            {(topicChoices.length > 0 || topicGone) && (
              <>
                <label htmlFor="launch-topic" className="text-muted-foreground">
                  Topic
                </label>
                <select
                  id="launch-topic"
                  value={topic?.id ?? ''}
                  onChange={(e) => pickTopic(e.target.value)}
                  aria-invalid={error?.field === 'topic' || undefined}
                  title={keepsInput ? "The Session is added to this Topic once it starts; the Topic's context goes at the top of the prompt." : 'The Session is added to this Topic once it starts.'}
                  className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                >
                  <option value="">None</option>
                  {topicGone && <option value={draft.topic!.id}>A deleted Topic</option>}
                  {topicChoices.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor="launch-prompt" className="self-start pt-1.5 text-muted-foreground">
              Prompt
            </label>
            <CommandsPopover control={slash} side="bottom">
              <Textarea
                id="launch-prompt"
                ref={promptRef}
                placeholder="optional · Enter for a new line"
                value={draft.prompt}
                aria-invalid={error?.field === 'prompt' || undefined}
                onChange={(e) => {
                  set({ prompt: e.target.value });
                  slash.typed(e.target.value);
                }}
                onBlur={slash.blurred}
                // LAUNCH-8.3: the list's Enter and Tab pick and its Esc closes it; any other key is the field's.
                onKeyDown={(e) => void slash.keyDown(e)}
                {...slash.field}
                className="max-h-[min(24rem,35dvh)] min-h-28 resize-y overflow-y-auto text-body leading-5"
                rows={5}
              />
            </CommandsPopover>
          </div>

          {harnesses.state === 'error' && <Alert title={harnesses.error} className="mx-5 mb-3" />}
          {error && <Alert title={error.message} className="mx-5 mb-3" />}

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {/* DS-8.4: a sentence is never a key; only Esc is. */}
            <span className="mr-auto text-meta text-muted-foreground">
              <Kbd>Esc</Kbd> to close · {handover ? 'your Handover is kept' : keepsInput ? 'your input is kept' : 'your input is discarded'}
            </span>
            <Button variant="secondary" size="form" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {handover && (
              <Button variant="secondary" size="form" type="button" disabled={!topic || keeping || submitting} title={topic ? undefined : 'Pick a Topic to keep it in'} onClick={() => void keep()}>
                {keeping ? 'Keeping…' : 'Keep in Topic'}
              </Button>
            )}
            <Button variant="primary" size="form" type="submit" disabled={!canStart}>
              {submitting ? 'Starting…' : 'Start'}
              <Kbd className="border-current/30 opacity-70">⌘↵</Kbd>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
