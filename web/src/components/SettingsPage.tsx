import type { Settings } from '@shared/settings.ts';
import { ArrowLeft, Folder, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlainView } from './Shell';

interface Props {
  settings: Settings;
  save(patch: Partial<Settings>): Promise<Settings>;
  onBack(): void;
}

/** SIDE-7.1: the Settings page. Values come from the server, so every tab shows the same. */
export function SettingsPage({ settings, save, onBack }: Props) {
  // What's typed; null while it matches the server's value, so changes from other tabs show.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });
  const value = draft ?? String(settings.idleThresholdHours);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const hours = Number(value);
    if (value.trim() === '' || !Number.isFinite(hours) || hours <= 0) {
      setState({ kind: 'error', message: 'Enter a number of hours above 0.' });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await save({ idleThresholdHours: hours });
      setDraft(null);
      setState({ kind: 'saved' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Saving failed.' });
    }
  };

  return (
    // SIDE-8.1: Back and the title sit in the main pane's header row, like every other view's.
    <PlainView
      header={
        <>
          <Button variant="ghost" size="sm" className="-ml-2.5 h-7 text-muted-foreground" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
          <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
        </>
      }
    >
      <div className="mx-auto w-full max-w-2xl px-8 py-7">
        <p className="text-[13px] text-muted-foreground">Saved on this Mac, shared by every Lookout tab.</p>

        <form onSubmit={submit} className="mt-6 rounded-lg border border-border bg-card p-4">
          <Label htmlFor="idle-threshold" className="text-[13px]">
            Idle threshold
          </Label>
          <p id="idle-threshold-help" className="mt-1 text-[12.5px] text-muted-foreground">
            Sessions that have been Idle longer than this are dimmed in the sidebar.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Input
              id="idle-threshold"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              aria-describedby="idle-threshold-help"
              aria-invalid={state.kind === 'error'}
              className="h-8 w-24"
              value={value}
              onChange={(e) => {
                setDraft(e.target.value);
                setState({ kind: 'idle' });
              }}
            />
            <span className="text-[13px] text-muted-foreground">hours</span>
            <Button type="submit" size="sm" className="ml-2 h-8" disabled={state.kind === 'saving' || draft === null}>
              Save
            </Button>
            <span role="status" className="ml-1 text-[12.5px] text-muted-foreground">
              {state.kind === 'saved' && 'Saved'}
            </span>
          </div>
          {state.kind === 'error' && (
            <p role="alert" className="mt-2 text-[12.5px] text-destructive">
              {state.message}
            </p>
          )}
        </form>

        <StartDirectories settings={settings} save={save} />
      </div>
    </PlainView>
  );
}

/** LAUNCH-2.2: the start directories the launcher offers. */
function StartDirectories({ settings, save }: Pick<Props, 'settings' | 'save'>) {
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirs = settings.startDirectories;

  const write = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await save({ startDirectories: next });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const dir = adding.trim();
    if (!dir) return;
    if (dirs.includes(dir)) {
      setError('That directory is already in the list.');
      return;
    }
    if (await write([...dirs, dir])) setAdding('');
  };

  return (
    <section aria-labelledby="start-dirs-title" className="mt-4 rounded-lg border border-border bg-card p-4">
      <h2 id="start-dirs-title" className="text-[13px] font-medium">
        Start directories
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">Where new Sessions can start. The launcher offers these.</p>
      <ul aria-label="Start directories" className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
        {dirs.map((d) => (
          <li key={d} className="flex items-center gap-2 px-2.5 py-1.5">
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={d}>
              {d}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${d}`}
              title={dirs.length === 1 ? 'Keep at least one start directory' : 'Remove'}
              disabled={busy || dirs.length === 1}
              onClick={() => void write(dirs.filter((x) => x !== d))}
              className="text-muted-foreground"
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <Input
          aria-label="Directory to add"
          placeholder="~/Projects/another-repo"
          value={adding}
          onChange={(e) => {
            setAdding(e.target.value);
            setError(null);
          }}
          className="h-8 flex-1 font-mono text-[12.5px]"
        />
        <Button type="submit" size="sm" variant="outline" className="h-8" disabled={busy || !adding.trim()}>
          Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
