import type { PeopleAnswer, PersonRow } from '@shared/people.ts';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Kbd } from '@/components/ui/kbd';
import { Loading } from '@/components/ui/loading';
import { type VaultRead, matchesPerson, oneOnOneLine, sortPeople, troubleWords } from '@/lib/people';
import { cn } from '@/lib/utils';
import { ShellCell } from './Shell';

export interface PeopleListProps {
  /** PEOPLE-3.4: the server's list of the Vault's Persons, or why there is none; nothing before its first answer. */
  read: VaultRead<PeopleAnswer>;
  /** The Person whose page shows; null for none. */
  selected: string | null;
  now: number;
  /** `replace`: a keyboard step, which shouldn't flood the history. */
  onSelect(name: string, how: 'push' | 'replace'): void;
  /** False while a dialog owns the keyboard, or another place shows. */
  keyboardEnabled: boolean;
}

/** A Person's row as a listbox option, for `aria-activedescendant`. */
const optionId = (index: number) => `people-row-${index}`;

/** PEOPLE-3.2: People's list, as the left column's header and body cells. */
export function PeopleList({ read, selected, now, onSelect, keyboardEnabled }: PeopleListProps) {
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const answer = read.answer;
  // PEOPLE-3.2: by name, A to Z in the browser's language.
  const all = useMemo(() => (answer?.state === 'ok' ? sortPeople(answer.people) : []), [answer]);
  // PEOPLE-3.5: the rows whose name contains what's typed.
  const rows = useMemo(() => all.filter((p) => matchesPerson(p.name, filter)), [all, filter]);

  // PEOPLE-3.5: the list's keys are the window's, as the Inbox's are (INBOX-5.1), while People is the place.
  const latest = useRef({ rows, selected, onSelect, enabled: keyboardEnabled });
  useEffect(() => {
    latest.current = { rows, selected, onSelect, enabled: keyboardEnabled };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { rows, selected, onSelect, enabled } = latest.current;
      if (e.isComposing || e.defaultPrevented || !enabled) return;
      // The right sidebar's panels have these keys for their own lists, and an open menu its own.
      if (e.target instanceof Element && e.target.closest('[data-shell-column="right"], [role="menu"]')) return;
      const inFilter = e.target === filterRef.current;
      const editing = !inFilter && isEditable(e.target);
      const index = rows.findIndex((r) => r.name === selected);
      const step = (delta: 1 | -1) => {
        if (!rows.length) return;
        const next = index === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta));
        onSelect(rows[next]!.name, 'replace');
      };

      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        // ⌘1–⌘9: the first to ninth row.
        if (!/^[1-9]$/.test(e.key)) return;
        e.preventDefault();
        const row = rows[Number(e.key) - 1];
        if (row) onSelect(row.name, 'push');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || editing) return;
      // ↑/↓ from inside a note's text scroll it instead, as a Report's (INBOX-5.1).
      const inNote = e.target instanceof Element && !!e.target.closest('[data-scroll-keys]');

      if (inFilter) {
        // Esc clears the filter and leaves it.
        if (e.key === 'Escape') {
          e.preventDefault();
          setFilter('');
          filterRef.current?.blur();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          step(e.key === 'ArrowDown' ? 1 : -1);
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        filterRef.current?.focus();
      } else if ((e.key === 'ArrowDown' && !inNote) || e.key === 'j') {
        e.preventDefault();
        step(1);
      } else if ((e.key === 'ArrowUp' && !inNote) || e.key === 'k') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Escape' && filter) {
        setFilter('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filter]);

  const body = (() => {
    // Before the server's first answer; a server that is away says so, with nothing to list.
    if (!answer) return read.error ? <Alert title="Couldn't read your Vault" detail={read.error} className="mx-2.5 my-3" data-field="people-error" /> : <Loading label="Reading your Vault…" className="items-center px-4 py-8 text-center" />;
    // PEOPLE-3.6: with no list the column says so in a line; the main pane has the way out.
    if (answer.state !== 'ok') {
      const words = troubleWords(answer);
      return words.kind === 'error' ? <Alert title={words.title} className="mx-2.5 my-3" data-field="people-error" /> : <EmptyState role="status" title={words.title} />;
    }
    if (rows.length === 0) return all.length > 0 ? <EmptyState role="status" title="Nothing matches" hint="Esc clears the filter." /> : <EmptyState role="status" title="No people yet" />;
    // DS-9.1: the list takes focus as the Inbox's does: the Person whose page shows is its active option.
    const at = rows.findIndex((r) => r.name === selected);
    return (
      <div
        role="listbox"
        aria-label="People"
        tabIndex={0}
        aria-activedescendant={at === -1 ? undefined : optionId(at)}
        className="flex flex-col rounded-md px-2 pt-1.5 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {rows.map((person, index) => (
          <PersonOption key={person.name} id={optionId(index)} person={person} now={now} selected={person.name === selected} onSelect={onSelect} />
        ))}
      </div>
    );
  })();

  return (
    <>
      {/* PEOPLE-3.5: the filter is this column's header cell, as the Inbox's is (INBOX-1.3). */}
      <ShellCell row="header" className="gap-1.5 border-sidebar-border px-2.5 py-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter people"
            placeholder="Filter people"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-6 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {!filter && <Kbd className="pointer-events-none absolute right-1.5 text-muted-foreground">/</Kbd>}
        </label>
      </ShellCell>
      <ShellCell row="body" className="flex flex-col" data-testid="people-list">
        {/* A failed ask after a good one: the list stays, marked as possibly old. */}
        {answer && read.error && <Alert tone="info" layout="inline" title={`Couldn't read your Vault again: ${read.error}`} className="mx-2.5 mt-2" data-field="people-stale" />}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{body}</div>
      </ShellCell>
    </>
  );
}

/**
 * PEOPLE-3.3: one Person's row, built as a Bot's row is (GUIDE, "A list row"): no leading icon,
 * their name, and under it one quiet line: when their last 1on1 note was.
 */
function PersonOption({ id, person, now, selected, onSelect }: { id: string; person: PersonRow; now: number; selected: boolean; onSelect(name: string, how: 'push' | 'replace'): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const line = oneOnOneLine(person, now);
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      aria-label={`${person.name}, ${line}`}
      onClick={() => onSelect(person.name, 'push')}
      data-slot="row"
      data-selected={selected || undefined}
      data-person={person.name}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md px-2 py-[7px] text-body select-none [--row-inset:8px] hover:bg-sidebar-accent/60', selected && 'bg-sidebar-accent')}
    >
      <span className="min-w-0 truncate font-medium" title={person.name} data-field="name">
        {person.name}
      </span>
      <span className="min-w-0 truncate text-meta text-muted-foreground" data-field="one-on-one">
        {line}
      </span>
    </div>
  );
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
