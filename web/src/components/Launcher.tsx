import type { LaunchChoices, LaunchHarness, Settings } from '@shared/settings.ts';
import type { LaunchRequest } from '@shared/types.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SaveError } from '@/lib/client';
import type { HarnessState, LaunchDraft } from '@/lib/launch';
import { cn } from '@/lib/utils';
import { criticalHint } from '@/lib/usage';
import { HarnessIcon } from './HarnessIcon';
import { UsageLevelIcon } from './UsageLevelIcon';

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
}

const FALLBACK_LABEL: Record<LaunchHarness, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The launcher (LAUNCH-1 … LAUNCH-4). */
export function Launcher({ open, onOpenChange, draft, onDraftChange, settings, harnesses, usage, now, onStart, onCloseAutoFocus }: Props) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  const list = harnesses.state === 'ready' ? harnesses.harnesses : null;
  const installed = (id: LaunchHarness) => !list || list.some((h) => h.id === id && h.installed);
  // A remembered Harness that's no longer installed falls back to one that is.
  const harness: LaunchHarness = installed(draft.harness)
    ? draft.harness
    : (list?.find((h) => h.installed)?.id ?? draft.harness);
  const models = list?.find((h) => h.id === harness)?.models ?? [{ id: '', label: 'Default', efforts: [], defaultEffort: null }];
  const model = models.some((m) => m.id === draft.model) ? draft.model : '';
  const chosen = models.find((m) => m.id === model);
  const levels = chosen?.efforts ?? [];
  const remembered = (id: LaunchHarness) => draft.byHarness?.[id] ?? settings.lastLaunch?.byHarness?.[id];
  const level = remembered(harness)?.effort;
  const effort = level && levels.includes(level) ? level : levels.includes('high') ? 'high' : (chosen?.defaultEffort ?? null);
  const skipPermissions = remembered(harness)?.skipPermissions ?? harness === 'claude';
  const directory = settings.startDirectories.includes(draft.directory) ? draft.directory : (settings.startDirectories[0] ?? '');
  const canStart = !submitting && harnesses.state === 'ready' && installed(harness) && directory !== '';

  const set = (patch: Partial<LaunchDraft>) => {
    onDraftChange({
      ...draft, directory, harness, model,
      byHarness: { ...draft.byHarness, [harness]: { effort, skipPermissions } },
      ...patch,
    });
    setError(null);
  };

  const setChoices = (patch: Partial<LaunchChoices>) => set({
    byHarness: { ...draft.byHarness, [harness]: { effort, skipPermissions, ...patch } },
  });

  const changeModel = (id: string) => {
    const next = models.find((m) => m.id === id);
    const nextEffort = effort && next?.efforts.includes(effort) ? effort
      : next?.efforts.includes('high') ? 'high' : (next?.defaultEffort ?? null);
    set({ model: id, byHarness: { ...draft.byHarness, [harness]: { effort: nextEffort, skipPermissions } } });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canStart) return;
    setSubmitting(true);
    setError(null);
    try {
      await onStart({ directory, harness, model, name: draft.name, prompt: draft.prompt, ...(levels.length && effort ? { effort } : {}), skipPermissions });
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
        <form onSubmit={submit} onKeyDown={onKeyDown} aria-label="New Session">
          <div className="border-b border-border px-5 pt-4 pb-3">
            <DialogTitle className="text-title">New Session</DialogTitle>
            <DialogDescription className="text-meta">Runs in its own Session host, so Lookout can control it.</DialogDescription>
          </div>

          <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-3 px-5 py-4 text-body">
            <label htmlFor="launch-directory" className="text-muted-foreground">
              Directory
            </label>
            <select
              id="launch-directory"
              value={directory}
              onChange={(e) => set({ directory: e.target.value })}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-body outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
            >
              {settings.startDirectories.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <span className="text-muted-foreground" id="launch-harness-label">
              Harness
            </span>
            <div role="radiogroup" aria-labelledby="launch-harness-label" className="flex flex-wrap gap-1.5">
              {(['claude', 'codex'] as const).map((id) => {
                const label = list?.find((h) => h.id === id)?.label ?? FALLBACK_LABEL[id];
                const disabled = !installed(id);
                const limit = criticalHint(usage?.providers.find((p) => p.id === id), now);
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1 select-none',
                      'has-checked:border-foreground/40 has-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring/30',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                    title={disabled ? `${label} isn't installed` : undefined}
                  >
                    <input
                      type="radio"
                      name="harness"
                      value={id}
                      checked={harness === id}
                      disabled={disabled}
                      onChange={() => set({ harness: id, model: '' })}
                      className="accent-foreground"
                    />
                    <HarnessIcon harness={id} tone="brand" className="size-4" />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="whitespace-nowrap">{label}</span>
                      {limit && (
                        <span className="text-caption font-medium text-destructive" data-field="limit-hint">
                          <UsageLevelIcon level="critical" className="align-[-2px] [&_svg]:size-3" />{' '}
                          {limit}
                        </span>
                      )}
                    </span>
                    {disabled && <span className="text-caption text-muted-foreground">not installed</span>}
                  </label>
                );
              })}
            </div>

            <label htmlFor="launch-model" className="text-muted-foreground">
              Model
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <select
                id="launch-model"
                value={model}
                onChange={(e) => changeModel(e.target.value)}
                disabled={!list}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 dark:bg-input/30"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {levels.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="launch-effort" className="text-muted-foreground">Effort</label>
                  <select
                    id="launch-effort"
                    value={effort ?? ''}
                    onChange={(e) => setChoices({ effort: e.target.value })}
                    aria-invalid={error?.field === 'effort' || undefined}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                  >
                    {levels.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <label
                className="flex min-h-6 cursor-pointer items-center gap-2"
                title={harness === 'claude'
                  ? 'Starts Claude Code with --dangerously-skip-permissions: no permission prompts.'
                  : 'Starts Codex with --dangerously-bypass-approvals-and-sandbox: no approval prompts or sandbox.'}
              >
                <Checkbox
                  checked={skipPermissions}
                  aria-describedby={harness === 'codex' ? 'launch-skip-note' : undefined}
                  onChange={(e) => setChoices({ skipPermissions: e.target.checked })}
                />
                Skip permissions
              </label>
              {harness === 'codex' && <span id="launch-skip-note" className="text-meta text-muted-foreground">Also turns off Codex's sandbox</span>}
            </div>

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

            <label htmlFor="launch-prompt" className="self-start pt-1.5 text-muted-foreground">
              Prompt
            </label>
            <Textarea
              id="launch-prompt"
              ref={promptRef}
              placeholder="optional · Enter for a new line"
              value={draft.prompt}
              aria-invalid={error?.field === 'prompt' || undefined}
              onChange={(e) => set({ prompt: e.target.value })}
              className="max-h-[min(24rem,35dvh)] min-h-28 resize-y overflow-y-auto text-body leading-5"
              rows={5}
            />
          </div>

          {harnesses.state === 'error' && <Alert title={harnesses.error} className="mx-5 mb-3" />}
          {error && <Alert title={error.message} className="mx-5 mb-3" />}

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {/* DS-8.4: a sentence is never a key; only Esc is. */}
            <span className="mr-auto text-meta text-muted-foreground">
              <Kbd>Esc</Kbd> to close · your input is kept
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canStart}>
              {submitting ? 'Starting…' : 'Start'}
              <Kbd className="border-current/30 opacity-70">⌘↵</Kbd>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
