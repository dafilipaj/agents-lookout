import { PRIVATE_FOLDER_ERROR, isFullPath, parsePrivateFolder } from '@shared/private-folders.ts';
import { DEFAULT_PEOPLE_FOLDER, PRIVATE_NEEDS_VAULT, type Settings, type SettingsView } from '@shared/settings.ts';
import { EyeOff, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  settings: SettingsView;
  save(patch: Partial<Settings>): Promise<unknown>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Saving failed.');

/** PEOPLE-2.10: said under the list while it holds a path inside the Vault and no Vault folder is set. */
export const PRIVATE_IDLE = 'No Vault folder is set, so the entries that aren’t full paths hide nothing.';

/** PEOPLE-1, PEOPLE-2, PEOPLE-3.2: Settings' Vault section: where the Vault is, the folders Lookout never lists or shows, and the folder that holds the people. */
export function VaultSection({ settings, save }: Props) {
  return (
    <div className="max-w-2xl">
      <p className="text-body text-muted-foreground">Your notes stay where they are: Lookout reads the Vault and never writes to it.</p>
      <VaultFolder settings={settings} save={save} />
      <PrivateFolders settings={settings} save={save} />
      <PeopleFolder settings={settings} save={save} />
    </div>
  );
}

/**
 * PEOPLE-1.1: the Vault folder, a full path. Empty clears it. The server says when it isn't a
 * directory, or when a Private folder inside it would be left without it (PEOPLE-1.2, 2.2); either
 * way the saved folder stays. "Saved", or "Cleared", only while the saved folder is the one it saved.
 */
function VaultFolder({ settings, save }: Props) {
  // What's typed; null while it shows the saved folder, so a change from another tab shows.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' } | { kind: 'saved'; folder: string | null } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const value = draft ?? settings.vaultFolder ?? '';
  const done = state.kind === 'saved' && state.folder === settings.vaultFolder ? (state.folder === null ? 'Cleared' : 'Saved') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const folder = value.trim().replace(/(.)\/+$/, '$1') || null;
    setState({ kind: 'saving' });
    try {
      await save({ vaultFolder: folder });
      setDraft(null);
      setState({ kind: 'saved', folder });
    } catch (err) {
      setState({ kind: 'error', message: message(err) });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 rounded-lg border border-border bg-card p-4">
      <Label htmlFor="vault-folder" className="text-body">
        Vault folder
      </Label>
      <p id="vault-folder-help" className="mt-1 text-meta text-muted-foreground">
        The folder of notes you keep in Obsidian. Lookout reads people and their notes from it. Leave it empty to read none.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          id="vault-folder"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="~/Documents/notes"
          aria-describedby="vault-folder-help"
          aria-invalid={state.kind === 'error'}
          className="h-8 min-w-0 flex-1 font-mono text-body"
          value={value}
          onChange={(e) => {
            setDraft(e.target.value);
            setState({ kind: 'idle' });
          }}
        />
        <Button variant="primary" size="form" type="submit" disabled={state.kind === 'saving' || draft === null}>
          Save
        </Button>
        <span role="status" className="ml-1 text-meta text-muted-foreground">
          {done}
        </span>
      </div>
      {state.kind === 'error' && <Alert layout="inline" title={state.message} className="mt-2" />}
    </form>
  );
}

/**
 * PEOPLE-2.1: the Private folders, a list you add to and remove from as Start directories are. An
 * entry the server would refuse is refused here with its words (PEOPLE-2.2), and so is anything the
 * server refuses; the saved list stays.
 */
function PrivateFolders({ settings, save }: Props) {
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const folders = settings.privateFolders;
  // PEOPLE-2.10: only a settings file edited by hand gets here; the list says so and doesn't read as if it hid them.
  const idle = settings.vaultFolder === null && folders.some((f) => !isFullPath(f));

  const write = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await save({ privateFolders: next });
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!adding.trim()) return;
    const entry = parsePrivateFolder(adding);
    if (entry === null) return setError(PRIVATE_FOLDER_ERROR);
    if (folders.includes(entry)) return setError('That folder is already in the list.');
    if (!isFullPath(entry) && settings.vaultFolder === null) return setError(PRIVATE_NEEDS_VAULT);
    if (await write([...folders, entry])) setAdding('');
  };

  return (
    <section aria-labelledby="private-folders-title" className="mt-4 rounded-lg border border-border bg-card p-4">
      <h2 id="private-folders-title" className="text-body font-medium">
        Private folders
      </h2>
      <p className="mt-1 text-meta text-muted-foreground">
        Lookout never lists or shows a file under these: not in the Library, a Report or a Topic, and not when its path is opened. A Session's own chat still shows what the Session read or wrote.
      </p>
      <p className="mt-1 text-meta text-muted-foreground">
        A folder inside the Vault, or a full path. <code className="font-mono">*</code> stands for any one folder's name, or a part of it: <code className="font-mono">Team/*/Reviews</code>.
      </p>
      {folders.length > 0 && (
        <ul aria-label="Private folders" className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
          {folders.map((f) => (
            <li key={f} className="flex items-center gap-2 px-2.5 py-1.5">
              <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-body" title={f}>
                {f}
              </span>
              <IconButton label={`Remove ${f}`} tip="Remove" disabled={busy} onClick={() => void write(folders.filter((x) => x !== f))} className="-my-0.5">
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <Input
          aria-label="Folder to make private"
          placeholder="Team/*/Reviews"
          spellCheck={false}
          autoComplete="off"
          value={adding}
          onChange={(e) => {
            setAdding(e.target.value);
            setError(null);
          }}
          className="h-8 flex-1 font-mono text-body"
        />
        <Button variant="secondary" size="form" type="submit" disabled={busy || !adding.trim()}>
          Add
        </Button>
      </form>
      {error && <Alert layout="inline" title={error} className="mt-2" />}
      {idle && <Alert tone="info" layout="inline" title={PRIVATE_IDLE} className="mt-2" />}
    </section>
  );
}

/**
 * PEOPLE-3.2: the people folder, a folder inside the Vault folder with a folder per Person. An
 * empty field is `Team` again. The server says why it refuses one; the saved folder stays.
 */
function PeopleFolder({ settings, save }: Props) {
  // What's typed; null while it shows the saved folder, so a change from another tab shows.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' } | { kind: 'saved'; folder: string } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const value = draft ?? settings.peopleFolder;
  const done = state.kind === 'saved' && state.folder === settings.peopleFolder ? 'Saved' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const folder = value.trim().replace(/\/+$/, '') || DEFAULT_PEOPLE_FOLDER;
    setState({ kind: 'saving' });
    try {
      await save({ peopleFolder: folder });
      setDraft(null);
      setState({ kind: 'saved', folder });
    } catch (err) {
      setState({ kind: 'error', message: message(err) });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-4 rounded-lg border border-border bg-card p-4">
      <Label htmlFor="people-folder" className="text-body">
        People folder
      </Label>
      <p id="people-folder-help" className="mt-1 text-meta text-muted-foreground">
        The folder inside the Vault that holds a folder for each person: People lists them. Leave it empty for <code className="font-mono">{DEFAULT_PEOPLE_FOLDER}</code>.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          id="people-folder"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={DEFAULT_PEOPLE_FOLDER}
          aria-describedby="people-folder-help"
          aria-invalid={state.kind === 'error'}
          className="h-8 min-w-0 flex-1 font-mono text-body"
          value={value}
          onChange={(e) => {
            setDraft(e.target.value);
            setState({ kind: 'idle' });
          }}
        />
        <Button variant="primary" size="form" type="submit" disabled={state.kind === 'saving' || draft === null}>
          Save
        </Button>
        <span role="status" className="ml-1 text-meta text-muted-foreground">
          {done}
        </span>
      </div>
      {state.kind === 'error' && <Alert layout="inline" title={state.message} className="mt-2" />}
    </form>
  );
}
