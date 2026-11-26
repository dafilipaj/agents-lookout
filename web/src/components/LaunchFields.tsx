import type { LaunchHarness } from '@shared/settings.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import { Checkbox } from '@/components/ui/checkbox';
import type { LaunchFieldsState } from '@/lib/launch-fields';
import { criticalHint } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { UsageLevelIcon } from './UsageLevelIcon';

/**
 * The fields a start is made of: Directory (LAUNCH-2.1), Harness (LAUNCH-3.1), Model with Effort
 * (LAUNCH-3.2, 3.4) and Skip permissions (LAUNCH-3.5). The launcher (`Launcher.tsx`) and the Bot
 * dialog (`BotDialog.tsx`, BOT-2.1) draw them from here, so a Bot is set up as a start is and looks
 * the same. What each field shows is `launchFields`' to say (`lib/launch-fields.ts`). Each field is
 * a label and its control, two cells of the form's grid (`FIELD_GRID`).
 */

/** The form's grid: a column of labels, then the controls. */
export const FIELD_GRID = 'grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-3 px-5 py-4 text-body';

/** A choice drawn as a box (a Harness, a Bot's day): its chosen look, neutral, never Primary, and keyboard focus. */
export const CHOSEN_LOOK = 'has-checked:border-foreground/40 has-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring/30';

const FALLBACK_LABEL: Record<LaunchHarness, string> = { claude: 'Claude Code', codex: 'Codex' };

const SELECT = 'rounded-md border border-input bg-transparent px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

interface DirectoryFieldProps {
  id: string;
  value: string;
  /** Settings' Start directories. */
  directories: readonly string[];
  /** A directory listed first though Settings doesn't list it, with the words its option shows. */
  own?: { directory: string; label: string } | null;
  invalid?: boolean;
  describedBy?: string;
  onChange(directory: string): void;
}

/** LAUNCH-2.1: the Start directory, picked from Settings' list. */
export function DirectoryField({ id, value, directories, own = null, invalid, describedBy, onChange }: DirectoryFieldProps) {
  return (
    <>
      <label htmlFor={id} className="text-muted-foreground">
        Directory
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn('h-8 w-full', SELECT, 'font-mono dark:bg-input/30')}
      >
        {own !== null && <option value={own.directory}>{own.label}</option>}
        {directories.filter((d) => d !== own?.directory).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </>
  );
}

interface HarnessFieldProps {
  /** The id of the field's label, which names the group. */
  labelId: string;
  /** The radios' form name. */
  name: string;
  fields: LaunchFieldsState;
  /** USAGE-3.1: a Harness at 95% or more of a window says so next to its name; without it, none does. */
  usage?: UsageSnapshot | null;
  now?: number;
  invalid?: boolean;
  describedBy?: string;
  onChange(harness: LaunchHarness): void;
}

/** LAUNCH-3.1: Claude Code or Codex, each with its mark; one that isn't installed is shown disabled. */
export function HarnessField({ labelId, name, fields, usage = null, now = 0, invalid, describedBy, onChange }: HarnessFieldProps) {
  const { list, installed, harness } = fields;
  return (
    <>
      <span className="text-muted-foreground" id={labelId}>
        Harness
      </span>
      <div role="radiogroup" aria-labelledby={labelId} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="flex flex-wrap gap-1.5">
        {(['claude', 'codex'] as const).map((id) => {
          const label = list?.find((h) => h.id === id)?.label ?? FALLBACK_LABEL[id];
          const disabled = !installed(id);
          const limit = criticalHint(usage?.providers.find((p) => p.id === id), now);
          return (
            <label
              key={id}
              className={cn('flex min-h-8 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1 select-none', CHOSEN_LOOK, disabled && 'cursor-not-allowed opacity-50')}
              title={disabled ? `${label} isn't installed` : undefined}
            >
              <input type="radio" name={name} value={id} checked={harness === id} disabled={disabled} onChange={() => onChange(id)} className="accent-foreground" />
              <HarnessIcon harness={id} tone="brand" className="size-4" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="whitespace-nowrap">{label}</span>
                {limit && (
                  <span className="text-caption font-medium text-destructive" data-field="limit-hint">
                    <UsageLevelIcon level="critical" className="align-[-2px] [&_svg]:size-3" /> {limit}
                  </span>
                )}
              </span>
              {disabled && <span className="text-caption text-muted-foreground">not installed</span>}
            </label>
          );
        })}
      </div>
    </>
  );
}

interface ModelFieldProps {
  /** The ids of its two selects are `<id>-model` and `<id>-effort`. */
  id: string;
  fields: LaunchFieldsState;
  modelInvalid?: boolean;
  effortInvalid?: boolean;
  describedBy?: string;
  onModel(model: string): void;
  onEffort(effort: string): void;
}

/** LAUNCH-3.2, 3.4: the chosen Harness's models, and beside it the Effort levels of the chosen model, when it lists any. */
export function ModelField({ id, fields, modelInvalid, effortInvalid, describedBy, onModel, onEffort }: ModelFieldProps) {
  const { list, models, model, levels, effort } = fields;
  return (
    <>
      <label htmlFor={`${id}-model`} className="text-muted-foreground">
        Model
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <select
          id={`${id}-model`}
          value={model}
          onChange={(e) => onModel(e.target.value)}
          disabled={!list}
          aria-invalid={modelInvalid || undefined}
          aria-describedby={describedBy}
          className={cn('h-8 min-w-0 flex-1', SELECT, 'disabled:opacity-60 dark:bg-input/30')}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {levels.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor={`${id}-effort`} className="text-muted-foreground">
              Effort
            </label>
            <select
              id={`${id}-effort`}
              value={effort ?? ''}
              onChange={(e) => onEffort(e.target.value)}
              aria-invalid={effortInvalid || undefined}
              aria-describedby={describedBy}
              className={cn('h-8', SELECT, 'dark:bg-input/30')}
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </>
  );
}

interface SkipPermissionsFieldProps {
  /** The id of Codex's note, which describes the checkbox. */
  noteId: string;
  fields: LaunchFieldsState;
  onChange(skipPermissions: boolean): void;
}

/** LAUNCH-3.5: Skip permissions, a checkbox under the model; for Codex its note says it also turns off the sandbox. */
export function SkipPermissionsField({ noteId, fields, onChange }: SkipPermissionsFieldProps) {
  const { harness, skipPermissions } = fields;
  return (
    <div className="col-start-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <label
        className="flex min-h-6 cursor-pointer items-center gap-2"
        title={harness === 'claude' ? 'Starts Claude Code with --dangerously-skip-permissions: no permission prompts.' : 'Starts Codex with --dangerously-bypass-approvals-and-sandbox: no approval prompts or sandbox.'}
      >
        <Checkbox checked={skipPermissions} aria-describedby={harness === 'codex' ? noteId : undefined} onChange={(e) => onChange(e.target.checked)} />
        Skip permissions
      </label>
      {harness === 'codex' && (
        <span id={noteId} className="text-meta text-muted-foreground">
          Also turns off Codex's sandbox
        </span>
      )}
    </div>
  );
}
