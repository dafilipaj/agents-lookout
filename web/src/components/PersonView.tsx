import type { NoteRow, OneOnOneRow, PeopleAnswer, PersonAnswer, PersonPage, VaultTrouble } from '@shared/people.ts';
import { comparable } from '@shared/private-folders.ts';
import { Settings as SettingsIcon } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/details';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import { OUTPUT_ICON } from '@/lib/outputs';
import { type VaultRead, dayWords, oneOnOneAge, oneOnOneFacts, troubleWords, useVaultRead } from '@/lib/people';
import { routePath } from '@/lib/router';
import { DOCUMENT_COLUMN } from './DocumentFile';
import { PlainView } from './Shell';

export interface PersonViewProps {
  /** The Person whose page shows, by their folder's name; null at People's start. */
  name: string | null;
  /** The list beside the page: what says why there is no Person to show (PEOPLE-3.6). */
  people: VaultRead<PeopleAnswer>;
  /** PEOPLE-4.2, 4.3: one Person's notes by name. */
  load(name: string): Promise<PersonAnswer>;
  /** PEOPLE-3.4: the Vault's settings as one text: a change of them asks again. */
  vaultKey: string;
  /** The server has answered once, so the settings a read is made under are the saved ones. */
  ready: boolean;
  now: number;
  /** PEOPLE-3.6: to Settings' Vault section. */
  onOpenSettings(): void;
  /** PEOPLE-4.4: a note, shown in the Document view. */
  onOpenNote(path: string): void;
  /** PEOPLE-4.6: the folder is spelled another way than the path has it: the path takes the folder's spelling. */
  onSpelling(name: string): void;
}

/** PEOPLE-3.6, PEOPLE-4: People's main pane: one Person's page, or what stands in for it. */
export function PersonView({ name, people, load, vaultKey, ready, now, onOpenSettings, onOpenNote, onSpelling }: PersonViewProps) {
  if (name !== null) return <OnePerson key={name} name={name} load={load} vaultKey={vaultKey} ready={ready} now={now} onOpenSettings={onOpenSettings} onOpenNote={onOpenNote} onSpelling={onSpelling} />;
  const answer = people.answer;
  return (
    <PlainView aria-label="People" data-view="people">
      {!answer ? (
        people.error ? (
          <Column>
            <Alert title="Couldn't read your Vault" detail={people.error} data-field="vault-error" />
          </Column>
        ) : (
          <Loading label="Reading your Vault…" className="p-8" />
        )
      ) : answer.state !== 'ok' ? (
        <Trouble trouble={answer} onOpenSettings={onOpenSettings} />
      ) : answer.people.length === 0 ? (
        // PEOPLE-3.6: no Person yet.
        <EmptyState role="status" className="h-full justify-center p-8" title="No people yet" hint={`Add a folder for each one to ${answer.folder}.`} data-field="no-people" />
      ) : (
        <EmptyState role="status" className="h-full justify-center p-8" title="Select a person" hint="Their 1on1 notes and their other notes show here." data-field="select" />
      )}
    </PlainView>
  );
}

/** LIB-2.2: a note is a Markdown file. */
const MarkdownIcon = OUTPUT_ICON.markdown;

const Column = ({ children }: { children: ReactNode }) => <div className={DOCUMENT_COLUMN}>{children}</div>;

/**
 * PEOPLE-3.6: what People needs and doesn't have. Nothing to list yet is an empty state with the way
 * to Settings; a folder the server can't read is an error (GUIDE, "A notice or an error").
 */
function Trouble({ trouble, onOpenSettings }: { trouble: VaultTrouble; onOpenSettings(): void }) {
  const words = troubleWords(trouble);
  if (words.kind === 'error') {
    return (
      <Column>
        <Alert title={words.title} detail={words.detail} data-field="vault-error" />
      </Column>
    );
  }
  return (
    <EmptyState
      role="status"
      className="h-full justify-center p-8"
      title={words.title}
      hint={words.detail}
      data-field="vault-missing"
      action={
        words.settings && (
          <Button variant="secondary" size="default" onClick={onOpenSettings} data-action="vault-settings">
            <SettingsIcon aria-hidden />
            Vault settings
          </Button>
        )
      }
    />
  );
}

/** PEOPLE-4: one Person's page: what you read before a 1on1. */
function OnePerson({ name, load, vaultKey, ready, now, onOpenSettings, onOpenNote, onSpelling }: Omit<PersonViewProps, 'people' | 'name'> & { name: string }) {
  // PEOPLE-3.4: read when the page shows, on focus after 30 s, and after a change of the Vault's settings.
  const read = useVaultRead(() => load(name), ready, `${vaultKey}\n${name}`);
  const answer = read.answer;
  const person = answer?.state === 'ok' ? answer.person : null;
  // PEOPLE-4.6: the folder's own spelling once the server found it; the path's until then.
  const title = person?.name ?? name;
  // And the path takes it, so their row in the list is the selected one and a note's link names them as the folder does.
  // Only for the same name spelled another way, as the server matched it: never to another Person.
  const spelled = person && person.name !== name && comparable(person.name) === comparable(name) ? person.name : null;
  useEffect(() => {
    if (spelled !== null) onSpelling(spelled);
  }, [spelled, onSpelling]);
  return (
    <PlainView
      aria-label={title}
      data-view="person"
      header={
        // PEOPLE-4.1: two lines, so the header row keeps its height (SIDE-8.4).
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="min-w-0 truncate text-title font-semibold tracking-tight" title={title}>
            {title}
          </h1>
          <div className="flex min-h-6 min-w-0 items-center text-meta text-muted-foreground" data-field="facts">
            {person && <span className="min-w-0 truncate">{oneOnOneFacts(person.oneOnOnes.map((n) => n.date), now)}</span>}
          </div>
        </div>
      }
    >
      {!answer ? (
        <Column>{read.error ? <Alert title="Couldn't read your Vault" detail={read.error} data-field="vault-error" /> : <Loading label="Reading your Vault…" />}</Column>
      ) : answer.state === 'gone' ? (
        // PEOPLE-4.6: renamed or moved in the notes app; the list beside it says who is there.
        <EmptyState role="status" className="h-full justify-center p-8" title={`No folder for ${name} in your Vault.`} hint={`It may have been renamed or moved in your notes app. People lists the folders in ${answer.folder}.`} data-field="gone" />
      ) : answer.state !== 'ok' ? (
        <Trouble trouble={answer} onOpenSettings={onOpenSettings} />
      ) : (
        <Notes person={answer.person} at={name} stale={read.error} now={now} onOpenNote={onOpenNote} />
      )}
    </PlainView>
  );
}

/** PEOPLE-4.2, 4.3: the Person's notes, top to bottom: their 1on1 notes, then their other notes. */
function Notes({ person, at, stale, now, onOpenNote }: { person: PersonPage; /** The Person as the path names them. */ at: string; stale: string | null; now: number; onOpenNote(path: string): void }) {
  return (
    <div className={DOCUMENT_COLUMN} data-field="person">
      {stale && <Alert tone="info" layout="inline" title={`Couldn't read your Vault again: ${stale}`} data-field="vault-stale" />}
      <NoteSection id="person-one-on-ones" label="1on1 notes" count={person.oneOnOnes.length} empty="No 1on1 notes yet. A note in their 1on1s folder with its date in its name shows here.">
        {person.oneOnOnes.map((note) => (
          <OneOnOneLink key={note.path} note={note} person={at} now={now} onOpenNote={onOpenNote} />
        ))}
      </NoteSection>
      <NoteSection id="person-notes" label="Notes" count={person.notes.length} empty="No other notes in their folder.">
        {person.notes.map((note) => (
          <NoteLink key={note.path} note={note} person={at} onOpenNote={onOpenNote}>
            <span className="min-w-0 truncate" title={note.name}>
              {note.name}
            </span>
          </NoteLink>
        ))}
      </NoteSection>
    </div>
  );
}

/** A section of the page under its label (GUIDE, "A section heading"), with how many it holds at its right. */
function NoteSection({ id, label, count, empty, children }: { id: string; label: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5 not-first:mt-4">
      <SectionLabel note={count > 0 ? count : undefined}>
        <span id={id}>{label}</span>
      </SectionLabel>
      {count === 0 ? (
        <p className="text-meta text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-labelledby={id} className="-mx-2 flex min-w-0 flex-col">
          {children}
        </ul>
      )}
    </section>
  );
}

/**
 * PEOPLE-4.4: a note's row: a real link to its path in the Document view, at its Person's, so
 * ⌘-click opens a new browser tab in People; a plain click, and Enter, show it in this one. The row
 * is the action (PEOPLE UX).
 */
function NoteLink({ note, person, onOpenNote, children }: { note: NoteRow; person: string; onOpenNote(path: string): void; children: ReactNode }) {
  const open = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpenNote(note.path);
  };
  return (
    <li className="min-w-0">
      <a
        href={routePath({ name: 'doc', path: note.path, person })}
        onClick={open}
        data-field="note"
        className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-[7px] text-body outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* LIB-2.2: a Markdown file's icon, the one the Library draws. */}
        <MarkdownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {children}
      </a>
    </li>
  );
}

/** PEOPLE-4.2: a 1on1 note's row: its date, what else its name says, and its age at the right. */
function OneOnOneLink({ note, person, now, onOpenNote }: { note: OneOnOneRow; person: string; now: number; onOpenNote(path: string): void }) {
  return (
    <NoteLink note={note} person={person} onOpenNote={onOpenNote}>
      {note.date ? (
        <>
          <span className="shrink-0 font-medium tabular-nums">{dayWords(note.date)}</span>
          {note.rest && (
            <span className="min-w-0 truncate text-muted-foreground" title={note.rest}>
              {note.rest}
            </span>
          )}
          <span className="ml-auto shrink-0 pl-2 text-meta text-muted-foreground tabular-nums" data-field="age">
            {oneOnOneAge(note.date, now)}
          </span>
        </>
      ) : (
        // No date in its name: the name itself.
        <span className="min-w-0 truncate" title={note.name}>
          {note.name}
        </span>
      )}
    </NoteLink>
  );
}
