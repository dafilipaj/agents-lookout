import { describe, expect, it } from 'vitest';
import { compareOneOnOnes, dayOf, daysBetween, isNoteFile, isPersonName, lastAndNext, noteDate, noteName, oneOnOneRest } from './people.ts';

describe('PEOPLE: what a folder’s and a note’s name say', () => {
  it('PEOPLE-3.2: a folder named Archive, or one whose name starts with a dot or an underscore, is no Person', () => {
    for (const name of ['Ines', 'Tomo K', 'Žana', 'archive-2025']) expect(isPersonName(name), name).toBe(true);
    for (const name of ['Archive', 'archive', 'ARCHIVE', '.obsidian', '_templates', '', '..', 'a/b', 'a\nb', 'x'.repeat(256)]) expect(isPersonName(name), name).toBe(false);
  });

  it('PEOPLE-4.2: a note is a Markdown file by its name, in any letter case, and never a dotfile', () => {
    for (const file of ['Ines 1on1 2026-11-24.md', 'notes.MD', 'a.b.md']) expect(isNoteFile(file), file).toBe(true);
    for (const file of ['.md', '.hidden.md', 'plan.txt', 'photo.png', 'md', 'Ines 1on1.md.icloud', '.Ines 1on1.md.icloud']) expect(isNoteFile(file), file).toBe(false);
    expect(noteName('Ines 1on1 2026-11-24.md')).toBe('Ines 1on1 2026-11-24');
    expect(noteName('notes.MD')).toBe('notes');
  });

  it('PEOPLE-4.2: a note’s date is the first day of the calendar in its name', () => {
    expect(noteDate('Ines 1on1 2026-11-24')).toBe('2026-11-24');
    expect(noteDate('2026-02-29 leap')).toBeNull();
    expect(noteDate('2028-02-29 leap')).toBe('2028-02-29');
    expect(noteDate('2026-13-01, then 2026-11-03')).toBe('2026-11-03');
    expect(noteDate('build 12026-11-240')).toBeNull();
    expect(noteDate('Ines 1on1')).toBeNull();
  });

  it('PEOPLE-4.2: a 1on1 note’s row says what its name does besides the Person’s name, "1on1" and the date', () => {
    expect(oneOnOneRest('Ines 1on1 2026-11-24', 'Ines')).toBe('');
    expect(oneOnOneRest('Ines 1on1 2026-11-24 - career talk', 'Ines')).toBe('career talk');
    expect(oneOnOneRest('2026-11-24 ines 1ON1 (offsite)', 'Ines')).toBe('(offsite)');
    // A name inside another word stays: only the Person's own name goes.
    expect(oneOnOneRest('Inessa plans 2026-11-24', 'Ines')).toBe('Inessa plans');
    // A name with characters an expression would read as its own.
    expect(oneOnOneRest('A.B (x) 1on1 2026-11-24 goals', 'A.B (x)')).toBe('goals');
    // Either encoding of an accented letter.
    expect(oneOnOneRest('Žana 1on1 2026-11-24 review', 'Žana')).toBe('review');
  });

  it('PEOPLE-4.2: 1on1 notes go newest first by date, and the ones without a date last, by name', () => {
    const rows = [
      { name: 'b undated', date: null },
      { name: 'Ines 1on1 2026-11-10', date: '2026-11-10' },
      { name: 'a undated', date: null },
      { name: 'Ines 1on1 2026-11-24', date: '2026-11-24' },
      { name: 'Ines 1on1 2026-11-24 b', date: '2026-11-24' },
    ];
    expect([...rows].sort(compareOneOnOnes).map((r) => r.name)).toEqual(['Ines 1on1 2026-11-24', 'Ines 1on1 2026-11-24 b', 'Ines 1on1 2026-11-10', 'a undated', 'b undated']);
  });

  it('PEOPLE-3.3: the last 1on1 is the newest date that isn’t after today, and the next the first that is', () => {
    expect(lastAndNext(['2026-11-10', null, '2026-11-24', '2026-12-01', '2026-12-08'], '2026-11-27')).toEqual({ last: '2026-11-24', next: '2026-12-01' });
    expect(lastAndNext(['2026-11-27'], '2026-11-27')).toEqual({ last: '2026-11-27', next: null });
    expect(lastAndNext(['2026-12-01'], '2026-11-27')).toEqual({ last: null, next: '2026-12-01' });
    expect(lastAndNext([null], '2026-11-27')).toEqual({ last: null, next: null });
  });

  it('PEOPLE-3.3: days are counted on the calendar, over a month’s end and a clock change', () => {
    expect(daysBetween('2026-11-24', '2026-11-27')).toBe(3);
    expect(daysBetween('2026-11-27', '2026-11-27')).toBe(0);
    expect(daysBetween('2026-11-27', '2026-12-01')).toBe(4);
    expect(daysBetween('2026-12-01', '2026-11-27')).toBe(-4);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(dayOf(new Date(2026, 10, 27, 23, 59).getTime())).toBe('2026-11-27');
    expect(dayOf(new Date(2026, 0, 5, 0, 0).getTime())).toBe('2026-01-05');
  });
});
