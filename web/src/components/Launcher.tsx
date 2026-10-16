import type { LaunchHarness, Settings } from '@shared/settings.ts';
import type { LaunchRequest } from '@shared/types.ts';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SaveError } from '@/lib/client';
import type { HarnessState, LaunchDraft } from '@/lib/launch';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  draft: LaunchDraft;
  onDraftChange(draft: LaunchDraft): void;
  settings: Settings;
  harnesses: HarnessState;
  /** Starts the Session; throws with a message for people when it fails. */
  onStart(req: LaunchRequest): Promise<void>;
}

const FALLBACK_LABEL: Record<LaunchHarness, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The launcher (LAUNCH-1 … LAUNCH-4). */
export function Launcher({ open, onOpenChange, draft, onDraftChange, settings, harnesses, onStart }: Props) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  const list = harnesses.state === 'ready' ? harnesses.harnesses : null;
  const installed = (id: LaunchHarness) => !list || list.some((h) => h.id === id && h.installed);
  // A remembered Harness that's no longer installed falls back to one that is.
  const harness: LaunchHarness = installed(draft.harness)
    ? draft.harness
    : (list?.find((h) => h.installed)?.id ?? draft.harness);
  const models = list?.find((h) => h.id === harness)?.models ?? [{ id: '', label: 'Default' }];
  const model = models.some((m) => m.id === draft.model) ? draft.model : '';
  const directory = settings.startDirectories.includes(draft.directory) ? draft.directory : (settings.startDirectories[0] ?? '');
  const canStart = !submitting && harnesses.state === 'ready' && installed(harness) && directory !== '';

  const set = (patch: Partial<LaunchDraft>) => {
    onDraftChange({ ...draft, directory, harness, model, ...patch });
    setError(null);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canStart) return;
    setSubmitting(true);
    setError(null);
    try {
      await onStart({ ...draft, directory, harness, model });
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
        className="gap-0 p-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          promptRef.current?.focus();
        }}
      >
        <form onSubmit={submit} onKeyDown={onKeyDown} aria-label="New Session">
          <div className="border-b border-border px-5 pt-4 pb-3">
            <DialogTitle className="text-[15px]">New Session</DialogTitle>
            <DialogDescription className="text-[12.5px]">Runs in its own Session host, so Lookout can control it.</DialogDescription>
          </div>

          <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-3 px-5 py-4 text-[13px]">
            <label htmlFor="launch-directory" className="text-muted-foreground">
              Directory
            </label>
            <select
              id="launch-directory"
              value={directory}
              onChange={(e) => set({ directory: e.target.value })}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
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
            <div role="radiogroup" aria-labelledby="launch-harness-label" className="flex gap-1.5">
              {(['claude', 'codex'] as const).map((id) => {
                const label = list?.find((h) => h.id === id)?.label ?? FALLBACK_LABEL[id];
                const disabled = !installed(id);
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input px-3 select-none',
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
                    {label}
                    {disabled && <span className="text-[11px] text-muted-foreground">not installed</span>}
                  </label>
                );
              })}
            </div>

            <label htmlFor="launch-model" className="text-muted-foreground">
              Model
            </label>
            <select
              id="launch-model"
              value={model}
              onChange={(e) => set({ model: e.target.value })}
              disabled={!list}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 dark:bg-input/30"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

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
              className="h-8 text-[13px]"
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
              className="min-h-28 resize-y text-[13px] leading-5"
              rows={5}
            />
          </div>

          {harnesses.state === 'error' && (
            <p role="alert" className="mx-5 mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
              {harnesses.error}
            </p>
          )}
          {error && (
            <p role="alert" className="mx-5 mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
              {error.message}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <kbd className="mr-auto font-mono text-[11px] text-muted-foreground">Esc to close · your input is kept</kbd>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canStart}>
              {submitting ? 'Starting…' : 'Start'}
              <kbd className="font-mono text-[11px] opacity-60">⌘↵</kbd>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
