import { BOT_DAYS, BOT_NAME_MAX, BOT_PROMPT_MAX, type BotDay, type BotInput, type BotView, scheduleWords } from '@shared/bots.ts';
import type { SettingsView } from '@shared/settings.ts';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Segmented } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';
import { ActionIcon } from '@/lib/actions';
import { SaveError } from '@/lib/client';
import { type HarnessState, initialDraft } from '@/lib/launch';
import { type LaunchPick, launchFields, pickChoices, pickHarness, pickModel, shownPick } from '@/lib/launch-fields';
import { cn } from '@/lib/utils';
import { CHOSEN_LOOK, DirectoryField, FIELD_GRID, HarnessField, ModelField, SkipPermissionsField } from './LaunchFields';

export interface BotDialogProps {
  /** Closed while null; New Bot with `bot` null, Edit with the Bot. */
  target: { bot: BotView | null } | null;
  /** BOT-2.1: what the launcher's fields choose from. */
  settings: SettingsView;
  harnesses: HarnessState;
  /** BOT-2.2: each rejects with a SaveError saying why, and which field when it's one of the dialog's. */
  create(input: BotInput): Promise<BotView>;
  update(id: string, patch: Partial<BotInput>): Promise<BotView>;
  /** A new Bot was made. */
  onCreated?(bot: BotView): void;
  onClose(): void;
  /** Where focus goes when it closes: it has no Trigger to return to. */
  onCloseAutoFocus?(e: Event): void;
}

/**
 * BOT-2.1: New Bot and Edit, one dialog, built as the launcher's (`Launcher.tsx`): Name, then the
 * launcher's own Directory, Harness, Model, Effort and Skip permissions (`LaunchFields.tsx`) and the
 * Prompt, then the Schedule (BOT-3.1). Save is the one Primary and ⌘Enter; Esc and Cancel close it
 * without saving. The form starts afresh each time it opens.
 */
export function BotDialog({ target, settings, harnesses, create, update, onCreated, onClose, onCloseAutoFocus }: BotDialogProps) {
  // A save on its way holds the dialog open, so what the server says about it has somewhere to show.
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl" onCloseAutoFocus={onCloseAutoFocus}>
        {target && <BotForm key={target.bot?.id ?? 'new'} bot={target.bot} settings={settings} harnesses={harnesses} create={create} update={update} onCreated={onCreated} onClose={onClose} saving={saving} onSaving={setSaving} />}
      </DialogContent>
    </Dialog>
  );
}

type Schedule = 'hand' | 'schedule';
const SCHEDULE_CHOICES: { id: Schedule; label: string }[] = [
  { id: 'hand', label: 'Only by hand' },
  { id: 'schedule', label: 'On a schedule' },
];
const DAY_LABEL: Record<BotDay, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
/** What "On a schedule" starts on, until you pick: the weekdays at nine. Nothing is saved before Save. */
const FIRST_DAYS: BotDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const FIRST_TIME = '09:00';

/** Where a refusal shows: beside the field the server names (BOT-2.2). Any other is said above the buttons. */
const PLACED = ['name', 'directory', 'harness', 'model', 'effort', 'skipPermissions', 'prompt', 'schedule'];
/** The fields a Bot shares with a start: a change to one answers a refusal about any of them. */
const START = ['directory', 'harness', 'model', 'effort', 'skipPermissions'];
const ERROR_ID = 'bot-field-error';

/** What Edit sends: only what differs from the Bot, so a change of name never asks about its Start directory again. */
function changed(input: BotInput, bot: BotView): Partial<BotInput> {
  const same = (key: keyof BotInput) => JSON.stringify(input[key]) === JSON.stringify(bot[key]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !same(key as keyof BotInput))) as Partial<BotInput>;
}

interface BotFormProps extends Pick<BotDialogProps, 'settings' | 'harnesses' | 'create' | 'update' | 'onCreated' | 'onClose'> {
  bot: BotView | null;
  saving: boolean;
  onSaving(saving: boolean): void;
}

function BotForm({ bot, settings, harnesses, create, update, onCreated, onClose, saving, onSaving }: BotFormProps) {
  const title = bot ? 'Edit Bot' : 'New Bot';
  const [name, setName] = useState(bot?.name ?? '');
  const [prompt, setPrompt] = useState(bot?.prompt ?? '');
  // BOT-2.1: a new Bot starts with the Harness, model and Start directory the launcher would (LAUNCH-1.2).
  const [pick, setPick] = useState<LaunchPick>(() => {
    if (bot) return { directory: bot.directory, harness: bot.harness, model: bot.model, byHarness: { [bot.harness]: { effort: bot.effort, skipPermissions: bot.skipPermissions } } };
    const last = initialDraft(settings);
    return { directory: last.directory, harness: last.harness, model: last.model };
  });
  // BOT-2.1: "Only by hand" for a new Bot. The days and the time are kept while it says so, for a change of mind.
  const [schedule, setSchedule] = useState<Schedule>(bot?.schedule ? 'schedule' : 'hand');
  const [days, setDays] = useState<BotDay[]>(bot?.schedule?.days ?? FIRST_DAYS);
  const [time, setTime] = useState(bot?.schedule?.time ?? FIRST_TIME);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  // A Bot whose Start directory left Settings still shows it, listed first; the server refuses it when it's sent (BOT-2.2).
  const gone = bot && !settings.startDirectories.includes(bot.directory) ? bot.directory : null;
  const fields = launchFields(pick, settings, harnesses, gone);
  const { installed, harness, model, levels, effort, skipPermissions, directory } = fields;
  const ready = harnesses.state === 'ready';
  const canSave = !saving && ready && installed(harness) && directory !== '';

  /** BOT-2.2: a refusal stays beside its field until that field changes; one about no field, until anything does. */
  const edited = (...of: string[]) => setError((e) => (e && (e.field === null || !PLACED.includes(e.field) || of.includes(e.field)) ? null : e));
  /** A change to the launcher's fields. Until Fleet's list is read they show stand-ins, which are never written over what the Bot has. */
  const start = (patch: Partial<LaunchPick>) => {
    setPick((p) => ({ ...(ready ? shownPick(p, fields) : p), ...patch }));
    edited(...START);
  };
  const skip = (next: boolean) => {
    const held = pick.byHarness?.[harness] ?? settings.lastLaunch?.byHarness?.[harness];
    start(ready ? pickChoices(pick, fields, { skipPermissions: next }) : { byHarness: { ...pick.byHarness, [harness]: { effort: held?.effort ?? null, skipPermissions: next } } });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSave) return;
    const input: BotInput = {
      name,
      prompt,
      harness,
      model,
      effort: levels.length ? effort : null,
      skipPermissions,
      directory,
      // BOT-3.1: the days Monday first, whatever order they were picked in.
      schedule: schedule === 'schedule' ? { days: BOT_DAYS.filter((d) => days.includes(d)), time } : null,
    };
    onSaving(true);
    setError(null);
    try {
      if (!bot) onCreated?.(await create(input));
      else {
        const patch = changed(input, bot);
        if (Object.keys(patch).length > 0) await update(bot.id, patch);
      }
      onSaving(false);
      onClose();
    } catch (err) {
      // BOT-2.2: stay open, say why beside its field, keep everything typed (LAUNCH-4.4).
      onSaving(false);
      setError({ message: err instanceof Error ? err.message : 'Saving the Bot failed.', field: err instanceof SaveError ? err.field : null });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const refused = (...of: string[]) => error !== null && error.field !== null && of.includes(error.field);
  /** BOT-2.2: what the server refused, under the field it named. */
  const refusal = (...of: string[]) => refused(...of) && <Alert layout="inline" id={ERROR_ID} title={error!.message} className="col-start-2 -mt-1.5" data-field="field-error" />;
  const described = (...of: string[]) => (refused(...of) ? ERROR_ID : undefined);

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} aria-label={title}>
      <div className="border-b border-border px-5 pt-4 pb-3">
        <DialogTitle className="truncate text-title">{title}</DialogTitle>
        <DialogDescription className="text-meta">Starts a Session with its prompt at its times, or when you press Run now. Its Report arrives in the Inbox.</DialogDescription>
      </div>

      <div className={FIELD_GRID}>
        <label htmlFor="bot-name" className="text-muted-foreground">
          Name
        </label>
        <Input
          id="bot-name"
          value={name}
          maxLength={BOT_NAME_MAX}
          autoComplete="off"
          aria-invalid={refused('name') || undefined}
          aria-describedby={described('name')}
          onChange={(e) => {
            setName(e.target.value);
            edited('name');
          }}
          className="h-8 text-body"
        />
        {refusal('name')}

        <DirectoryField
          id="bot-directory"
          value={directory}
          directories={settings.startDirectories}
          own={gone !== null ? { directory: gone, label: `${gone} · no longer in Settings` } : null}
          invalid={refused('directory')}
          describedBy={described('directory')}
          onChange={(next) => start({ directory: next })}
        />
        {refusal('directory')}
        <HarnessField labelId="bot-harness-label" name="bot-harness" fields={fields} invalid={refused('harness')} describedBy={described('harness')} onChange={(id) => start(pickHarness(id))} />
        {refusal('harness')}
        <ModelField
          id="bot"
          fields={fields}
          modelInvalid={refused('model')}
          effortInvalid={refused('effort')}
          describedBy={described('model', 'effort')}
          onModel={(id) => start(pickModel(pick, fields, id))}
          onEffort={(next) => start(pickChoices(pick, fields, { effort: next }))}
        />
        {refusal('model', 'effort')}
        <SkipPermissionsField noteId="bot-skip-note" fields={fields} onChange={skip} />
        {refusal('skipPermissions')}

        <label htmlFor="bot-prompt" className="self-start pt-1.5 text-muted-foreground">
          Prompt
        </label>
        <Textarea
          id="bot-prompt"
          placeholder="What it asks each time · Enter for a new line"
          value={prompt}
          maxLength={BOT_PROMPT_MAX}
          aria-invalid={refused('prompt') || undefined}
          aria-describedby={described('prompt')}
          onChange={(e) => {
            setPrompt(e.target.value);
            edited('prompt');
          }}
          className="max-h-[min(24rem,35dvh)] min-h-28 resize-y overflow-y-auto text-body leading-5"
          rows={5}
        />
        {refusal('prompt')}

        <span id="bot-schedule-label" className="self-start pt-1 text-muted-foreground">
          Schedule
        </span>
        {/* BOT-3.1: only by hand, or one or more days of the week and one time of day. */}
        <div role="group" aria-labelledby="bot-schedule-label" aria-describedby={described('schedule')} className="flex min-w-0 flex-col gap-2">
          <Segmented
            label="Schedule"
            choices={SCHEDULE_CHOICES}
            value={schedule}
            onChange={(next) => {
              setSchedule(next);
              edited('schedule');
            }}
          />
          {schedule === 'schedule' && (
            <>
              <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
                {BOT_DAYS.map((d) => (
                  // A day is a toggle with the Harness choice's chosen look; its checkbox is what the keyboard and a screen reader meet.
                  <label key={d} className={cn('flex h-8 cursor-pointer items-center rounded-md border border-input px-2.5 select-none', CHOSEN_LOOK)}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={days.includes(d)}
                      onChange={(e) => {
                        setDays((held) => (e.target.checked ? [...held, d] : held.filter((x) => x !== d)));
                        edited('schedule');
                      }}
                    />
                    {DAY_LABEL[d]}
                  </label>
                ))}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label htmlFor="bot-time" className="text-muted-foreground">
                  Time
                </label>
                <Input
                  id="bot-time"
                  type="time"
                  value={time}
                  aria-invalid={refused('schedule') || undefined}
                  onChange={(e) => {
                    setTime(e.target.value);
                    edited('schedule');
                  }}
                  className="h-8 w-28 text-body"
                />
                {/* BOT-3.1: the schedule in the words it has everywhere else, as it's picked. */}
                {days.length > 0 && time !== '' && (
                  <span className="min-w-0 truncate text-meta text-muted-foreground" data-field="schedule-words">
                    {scheduleWords({ days, time })}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {refusal('schedule')}
      </div>

      {harnesses.state === 'error' && <Alert title={harnesses.error} className="mx-5 mb-3" />}
      {error && !refused(...PLACED) && <Alert title={error.message} className="mx-5 mb-3" />}

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        {/* DS-8.4: a sentence is never a key; only Esc is. */}
        <span className="mr-auto text-meta text-muted-foreground">
          <Kbd>Esc</Kbd> to close · nothing is saved
        </span>
        <Button variant="secondary" size="form" type="button" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="form" type="submit" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
          <Kbd className="border-current/30 opacity-70">⌘↵</Kbd>
        </Button>
      </div>
    </form>
  );
}

/** BOT-2.4: what the server says too, when it refuses to delete a Bot with a run going. */
const RUNNING = "It's running. Wait for it, or end its Session.";

export interface DeleteBotDialogProps {
  /** The Bot to delete, as the server last sent it; closed while null. */
  bot: BotView | null;
  /** BOT-2.4: rejects with why it couldn't: one of the Bot's runs is going (409). */
  remove(id: string): Promise<void>;
  onClose(): void;
  onCloseAutoFocus?(e: Event): void;
}

/**
 * BOT-2.4: Delete asks first, as a Local server's Stop does (`ServersPanel.tsx`): it names the Bot
 * and says its Reports stay in the Inbox, and its confirm is the red fill (DS-18.1). A Bot with a run
 * going can't be deleted: the dialog says to wait for it or end its Session, whether the tab knows
 * it already or the server says so.
 */
export function DeleteBotDialog({ bot, remove, onClose, onCloseAutoFocus }: DeleteBotDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Another Bot clears the last one's error; adjusting state while rendering, as React documents.
  const [shownFor, setShownFor] = useState<string | null>(null);
  const id = bot?.id ?? null;
  if (id !== shownFor) {
    setShownFor(id);
    setError(null);
  }
  const running = bot !== null && bot.running !== null;
  const confirm = async () => {
    if (!bot || busy || running) return;
    setBusy(true);
    setError(null);
    try {
      await remove(bot.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={bot !== null} onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onCloseAutoFocus={onCloseAutoFocus}>
        {bot && (
          <>
            <DialogTitle className="text-title">Delete “{bot.name}”?</DialogTitle>
            <DialogDescription className="text-body leading-5">It starts no more runs. Its Reports stay in the Inbox, and the Sessions it started stay in History.</DialogDescription>
            {(running || error) && <Alert title={running ? RUNNING : error} />}
            <DialogFooter>
              <Button variant="secondary" size="form" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" size="form" onClick={() => void confirm()} disabled={busy || running}>
                <ActionIcon id="delete" />
                {busy ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
