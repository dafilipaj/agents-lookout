import { type PersonRow, type VaultTrouble, dayOf, daysBetween, lastAndNext } from '@shared/people.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDayAge } from './time.ts';

/** PEOPLE-3.4: how old a read must be for the window's focus to ask again. */
export const VAULT_FRESH_MS = 30_000;

export interface VaultRead<T> {
  /** The server's last answer for what is asked now; null before the first. */
  answer: T | null;
  /** Why the last ask got no answer (the server away), with the answer before it kept. */
  error: string | null;
}

/**
 * PEOPLE-3.4: a read of the Vault, asked when what it is for shows (`active`), when the window gets
 * focus again 30 s or more after the last ask, and when `key` changes: the Vault's settings, or
 * the Person. The last answer stays while the next is asked; a new `key` drops it.
 */
export function useVaultRead<T>(load: () => Promise<T>, active: boolean, key: string): VaultRead<T> {
  const [read, setRead] = useState<{ key: string; answer: T | null; error: string | null }>({ key, answer: null, error: null });
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const asked = useRef({ at: 0, n: 0 });
  const ask = useCallback(() => {
    const n = ++asked.current.n;
    asked.current.at = Date.now();
    latest.current().then(
      (answer) => {
        if (asked.current.n === n) setRead({ key, answer, error: null });
      },
      (err: unknown) => {
        // A failed ask leaves what was read for this key on screen.
        if (asked.current.n === n) setRead((was) => ({ key, answer: was.key === key ? was.answer : null, error: err instanceof Error ? err.message : "Couldn't read your Vault." }));
      },
    );
  }, [key]);
  useEffect(() => {
    if (!active) return;
    // One counter for the hook's life: the asks made, and when the last was.
    const asks = asked.current;
    ask();
    const onFocus = () => {
      if (Date.now() - asks.at >= VAULT_FRESH_MS) ask();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      // An answer still on its way is for a view that no longer shows it.
      asks.n++;
    };
  }, [active, ask]);
  return read.key === key ? { answer: read.answer, error: read.error } : { answer: null, error: null };
}

/** "1 1on1 note", "12 1on1 notes". */
const noteCount = (n: number) => `${n} 1on1 note${n === 1 ? '' : 's'}`;

/**
 * PEOPLE-3.3: a Person's row's second line: when their last 1on1 note was ("1on1 3d ago", "1on1
 * today"), else when the next is ("1on1 in 4d"), else how many there are, or that there are none;
 * for a folder the server couldn't read, that.
 */
export function oneOnOneLine(row: Pick<PersonRow, 'oneOnOnes' | 'last' | 'next' | 'unread'>, now: number): string {
  // A folder that gave no answer is never "no notes" (PEOPLE-3.3).
  if (row.unread) return "Couldn't read their notes";
  const today = dayOf(now);
  // The server told last from next by its day at the read: a "next" that today has reached is the last by now.
  const day = row.next !== null && row.next <= today ? row.next : (row.last ?? row.next);
  if (day !== null) return `1on1 ${formatDayAge(daysBetween(day, today))}`;
  return row.oneOnOnes > 0 ? noteCount(row.oneOnOnes) : 'No 1on1 notes';
}

/** PEOPLE-4.1: a Person's header facts: "12 1on1 notes · last 3d ago", "1 1on1 note · next in 4d". */
export function oneOnOneFacts(dates: readonly (string | null)[], now: number): string {
  if (dates.length === 0) return 'No 1on1 notes';
  const today = dayOf(now);
  const { last, next } = lastAndNext(dates, today);
  const when = last !== null ? `last ${formatDayAge(daysBetween(last, today))}` : next !== null ? `next ${formatDayAge(daysBetween(next, today))}` : null;
  return when ? `${noteCount(dates.length)} · ${when}` : noteCount(dates.length);
}

/** PEOPLE-4.2: a 1on1 note's age in its row's column: "3d", "today", "in 4d". */
export const oneOnOneAge = (date: string, now: number): string => formatDayAge(daysBetween(date, dayOf(now)), 'column');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** PEOPLE-4.2: a note's date as its row shows it: "24 Nov 2026". */
export const dayWords = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''} ${day.slice(0, 4)}`;

/** Letters whose plain form no decomposition gives: a stroke through the letter, two letters in one. */
const STROKED: Readonly<Record<string, string>> = { đ: 'd', ð: 'd', ł: 'l', ø: 'o', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' };
/** Letters without their case or their accents, so "zana" finds "Žana" and "duro" finds "Đuro". */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[đðłøıßæœþ]/g, (letter) => STROKED[letter] ?? letter);
/** PEOPLE-3.5: whether a Person's name contains what's typed, whatever the case or accents. */
export const matchesPerson = (name: string, query: string): boolean => plain(name).includes(plain(query.trim()));

/** PEOPLE-3.2: the Persons by name, A to Z in the browser's language. */
export const sortPeople = <T extends { name: string }>(people: readonly T[]): T[] => [...people].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name));

/** PEOPLE-3.6: what the main pane says when there is no list, and whether Settings' Vault section is the way out. */
export function troubleWords(trouble: VaultTrouble): { kind: 'empty' | 'error'; title: string; detail: string; settings: boolean } {
  switch (trouble.state) {
    case 'no-vault':
      return { kind: 'empty', title: 'People reads your Vault.', detail: 'Set the Vault folder in Settings: the folder of notes you keep in Obsidian.', settings: true };
    case 'no-folder':
      return { kind: 'empty', title: `No ${trouble.folder} folder in your Vault.`, detail: 'People lists the folders inside it, one for each person. Make it in your notes app, or name another folder in Settings.', settings: true };
    case 'unreadable':
      return {
        kind: 'error',
        title: "Lookout can't read your Vault.",
        detail:
          trouble.reason === 'denied'
            ? 'macOS refused the read. Allow the folder for Lookout’s server in System Settings, under Privacy & Security, Files and Folders.'
            : trouble.reason === 'slow'
              ? 'The folder gave no answer in 5 s. It may be on a disk or a cloud drive that isn’t there right now.'
              : trouble.reason === 'path'
                ? 'Its path has a ~ or a : in it, and Lookout opens no file under such a path. Obsidian’s own iCloud folder is one.'
                : trouble.detail
                  ? `The disk said ${trouble.detail}.`
                  : 'The disk gave no reason.',
        settings: false,
      };
  }
}
