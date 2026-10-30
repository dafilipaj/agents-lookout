import { PRODUCTIVE_EMAIL_ERROR, type Settings, type SettingsView, parseProductiveEmail } from '@shared/settings.ts';
import type { ToolsSnapshot } from '@shared/tools.ts';
import { ArrowLeft, Folder, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlainView } from './Shell';
import { ToolsSection } from './ToolsSection';

interface Props {
  settings: SettingsView;
  save(patch: Partial<Settings>): Promise<unknown>;
  onBack(): void;
  /** TOOLS: the last read of every Tool, and how to ask for another. */
  tools: ToolsSnapshot | null;
  now: number;
  loadTools(): Promise<unknown>;
  refreshTools(): Promise<unknown>;
}

/** SIDE-7.1: the Settings page. Values come from the server, so every tab shows the same. */
export function SettingsPage({ settings, save, onBack, tools, now, loadTools, refreshTools }: Props) {
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
          <h1 className="text-title font-semibold tracking-tight">Settings</h1>
        </>
      }
    >
      <div className="mx-auto w-full max-w-2xl px-8 py-7">
        <p className="text-body text-muted-foreground">Saved on this Mac, shared by every Lookout tab.</p>

        <form onSubmit={submit} className="mt-6 rounded-lg border border-border bg-card p-4">
          <Label htmlFor="idle-threshold" className="text-body">
            Idle threshold
          </Label>
          <p id="idle-threshold-help" className="mt-1 text-meta text-muted-foreground">
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
            <span className="text-body text-muted-foreground">hours</span>
            <Button type="submit" size="sm" className="ml-2 h-8" disabled={state.kind === 'saving' || draft === null}>
              Save
            </Button>
            <span role="status" className="ml-1 text-meta text-muted-foreground">
              {state.kind === 'saved' && 'Saved'}
            </span>
          </div>
          {state.kind === 'error' && <Alert layout="inline" title={state.message} className="mt-2" />}
        </form>

        <ProductiveEmail settings={settings} save={save} />

        <StartDirectories settings={settings} save={save} />

        <ToolsSection tools={tools} now={now} load={loadTools} refresh={refreshTools} />
      </div>
    </PlainView>
  );
}

/**
 * WORK-2.5, WORK-2.7: whose Tasks Work reads. While none is saved, the field holds the address from
 * `git config --global user.email` as a suggestion, saved only when you press Save. A value the
 * server would refuse is refused here with its words, and so is anything the server refuses;
 * either way the saved email stays. An empty field clears it (WORK-2.6). A save says "Saved", or
 * "Cleared", only while the saved email is still the one it saved: never "Saved" beside the
 * suggestion, which isn't saved.
 */
function ProductiveEmail({ settings, save }: Pick<Props, 'settings' | 'save'>) {
  // What's typed; null while it shows the saved email, or the suggestion when none is saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' } | { kind: 'saved'; email: string | null } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const suggested = settings.productiveEmail === null ? settings.productiveEmailSuggestion : null;
  const value = draft ?? settings.productiveEmail ?? suggested ?? '';
  const showsSuggestion = draft === null && suggested !== null;
  const done = state.kind === 'saved' && state.email === settings.productiveEmail ? (state.email === null ? 'Cleared' : 'Saved') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let email: string | null;
    try {
      email = parseProductiveEmail(value);
    } catch {
      setState({ kind: 'error', message: PRODUCTIVE_EMAIL_ERROR });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await save({ productiveEmail: email });
      setDraft(null);
      setState({ kind: 'saved', email });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Saving failed.' });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 rounded-lg border border-border bg-card p-4">
      <Label htmlFor="productive-email" className="text-body">
        Productive email
      </Label>
      <p id="productive-email-help" className="mt-1 text-meta text-muted-foreground">
        Work lists the open Tasks assigned to this email in Productive. Leave it empty to read none.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          id="productive-email"
          type="text"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="name@example.com"
          aria-describedby={showsSuggestion ? 'productive-email-help productive-email-suggestion' : 'productive-email-help'}
          aria-invalid={state.kind === 'error'}
          className="h-8 min-w-0 flex-1"
          value={value}
          onChange={(e) => {
            setDraft(e.target.value);
            setState({ kind: 'idle' });
          }}
        />
        <Button type="submit" size="sm" className="h-8" disabled={state.kind === 'saving' || (draft === null && !showsSuggestion)}>
          Save
        </Button>
        <span role="status" className="ml-1 text-meta text-muted-foreground">
          {done}
        </span>
      </div>
      {showsSuggestion && (
        <p id="productive-email-suggestion" className="mt-2 text-meta text-muted-foreground" data-field="suggestion">
          From your git config. Not saved yet: press Save to use it.
        </p>
      )}
      {state.kind === 'error' && <Alert layout="inline" title={state.message} className="mt-2" />}
    </form>
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
      <h2 id="start-dirs-title" className="text-body font-medium">
        Start directories
      </h2>
      <p className="mt-1 text-meta text-muted-foreground">Where new Sessions can start. The launcher offers these.</p>
      <ul aria-label="Start directories" className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
        {dirs.map((d) => (
          <li key={d} className="flex items-center gap-2 px-2.5 py-1.5">
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-body" title={d}>
              {d}
            </span>
            <IconButton
              label={`Remove ${d}`}
              tip={dirs.length === 1 ? 'Keep at least one start directory' : 'Remove'}
              disabled={busy || dirs.length === 1}
              onClick={() => void write(dirs.filter((x) => x !== d))}
              className="-my-0.5"
            >
              <X />
            </IconButton>
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
          className="h-8 flex-1 font-mono text-body"
        />
        <Button type="submit" size="sm" variant="outline" className="h-8" disabled={busy || !adding.trim()}>
          Add
        </Button>
      </form>
      {error && <Alert layout="inline" title={error} className="mt-2" />}
    </section>
  );
}
