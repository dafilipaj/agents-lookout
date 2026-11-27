import { describe, expect, it } from 'vitest';
import { comparable, isFullPath, literalPrefix, parsePrivateFolder, privateMatcher, privatePatterns } from './private-folders.ts';

const HOME = '/Users/ines';
const VAULT = '~/notes';
const matcher = (entries: string[], vaults: string[] = [VAULT]) => privateMatcher(privatePatterns(entries, vaults, HOME));

describe('PEOPLE-2: Private folders', () => {
  it('PEOPLE-2.1: an entry is a path inside the Vault folder or a full path, and `*` stands for any run of characters inside one folder’s name', () => {
    expect(isFullPath('Team/Reviews')).toBe(false);
    expect(isFullPath('~/notes/private')).toBe(true);
    expect(isFullPath('/srv/private')).toBe(true);

    // A path inside the Vault: the folder, and every file under it at any depth.
    const inside = matcher(['Team/Reviews']);
    expect(inside('/Users/ines/notes/Team/Reviews/a.md')).toBe(true);
    expect(inside('/Users/ines/notes/Team/Reviews/2026/deep/a.md')).toBe(true);
    // The folder's own path is no file under it.
    expect(inside('/Users/ines/notes/Team/Reviews')).toBe(false);
    expect(inside('/Users/ines/notes/Team/Reviews 2/a.md')).toBe(false);
    expect(inside('/Users/ines/notes/Team/a.md')).toBe(false);
    expect(inside('/Users/ines/other/Team/Reviews/a.md')).toBe(false);

    // `*` is one folder's name, or a part of it; it never crosses a `/`.
    const everyone = matcher(['Team/*/Reviews']);
    expect(everyone('/Users/ines/notes/Team/Tomo/Reviews/q3.md')).toBe(true);
    expect(everyone('/Users/ines/notes/Team/Mira/Reviews/feedback/a.md')).toBe(true);
    expect(everyone('/Users/ines/notes/Team/Tomo/1on1s/2026-11-24.md')).toBe(false);
    expect(everyone('/Users/ines/notes/Team/Tomo/deeper/Reviews/a.md')).toBe(false);
    const cycles = matcher(['Team/360 *']);
    expect(cycles('/Users/ines/notes/Team/360 Q3 2026/prep/a.md')).toBe(true);
    expect(cycles('/Users/ines/notes/Team/360/a.md')).toBe(false);
    expect(cycles('/Users/ines/notes/Team/Tomo/360 notes.md')).toBe(false);
    // An entry names a folder, never a file: a file whose own name matches one is not private.
    expect(cycles('/Users/ines/notes/Team/360 notes.md')).toBe(false);
    expect(matcher(['Team/a.md'])('/Users/ines/notes/Team/a.md')).toBe(false);

    // A full path, `~` included, is a folder anywhere.
    const anywhere = matcher(['~/work/output/reviews', '/srv/*/private']);
    expect(anywhere('/Users/ines/work/output/reviews/a.html')).toBe(true);
    expect(anywhere('/srv/team/private/a.md')).toBe(true);
    expect(anywhere('/srv/team/public/a.md')).toBe(false);
  });

  it('PEOPLE-2.2: an entry is refused when it is empty, too long, on two lines, has an empty, `.` or `..` part, or two `*` in a row', () => {
    expect(parsePrivateFolder('  Team/*/Reviews/  ')).toBe('Team/*/Reviews');
    expect(parsePrivateFolder('~/notes/private')).toBe('~/notes/private');
    for (const bad of ['', '   ', 'a\nb', 'Team//Reviews', './Team', 'Team/../Reviews', 'Team/./Reviews', 'Team/**/Reviews', '**', '/', '~', '~someone/notes', 'x'.repeat(301), 7, null]) {
      expect(parsePrivateFolder(bad), String(bad).slice(0, 20)).toBeNull();
    }
    expect(parsePrivateFolder('x'.repeat(300))).not.toBeNull();
  });

  it('PEOPLE-2.2: a full path that names no folder outright is refused, since it would hide everything; inside the Vault a lone `*` is every folder there', () => {
    for (const all of ['/*', '~/*', '/*/*', '/a*', '~/*x/y*']) expect(parsePrivateFolder(all), all).toBeNull();
    for (const fine of ['/*/private', '~/notes/*', '*', 'Team/*']) expect(parsePrivateFolder(fine), fine).toBe(fine);
  });

  it('PEOPLE-2.3: an entry of many `*` is matched without an expression, so a long name that almost matches answers at once', () => {
    const stars = '*a'.repeat(140); // 280 characters, 140 of them `*`
    expect(parsePrivateFolder(`Team/${stars}`)).not.toBeNull();
    const m = matcher([`Team/${stars}`]);
    const started = performance.now();
    expect(m(`/Users/ines/notes/Team/${'a'.repeat(254)}b/x.md`)).toBe(false);
    expect(m(`/Users/ines/notes/Team/${'a'.repeat(255)}/x.md`)).toBe(true);
    expect(m(`/Users/ines/notes/Team/${'a'.repeat(139)}/x.md`)).toBe(false);
    // An expression would back off once per `*` here and not come back for minutes.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('PEOPLE-2.3: paths are compared whatever the letter case and however an accented letter is encoded, against each form of the Vault folder', () => {
    const composed = 'Team/Žana/Reviews'; // Ž as one character
    const decomposed = 'Team/Žana/Reviews'; // Z and a combining caron
    expect(comparable(composed)).toBe(comparable(decomposed));
    const m = matcher([composed]);
    expect(m(`/Users/ines/notes/${decomposed}/a.md`)).toBe(true);
    expect(m('/users/INES/Notes/team/žana/reviews/A.MD')).toBe(true);

    // The Vault folder as set and as it resolves: an entry inside it holds under both.
    const both = matcher(['Team/Reviews'], ['~/notes', '/Volumes/disk/notes']);
    expect(both('/Users/ines/notes/Team/Reviews/a.md')).toBe(true);
    expect(both('/Volumes/disk/notes/Team/Reviews/a.md')).toBe(true);

    // With no Vault folder, a path inside it matches nothing, and a full path still does.
    const none = matcher(['Team/Reviews', '/srv/private'], []);
    expect(none('/Users/ines/notes/Team/Reviews/a.md')).toBe(false);
    expect(none('/srv/private/a.md')).toBe(true);

    // Characters that mean something in an expression are plain text in an entry.
    const plain = matcher(['Team/Q3 (2026)+[draft]']);
    expect(plain('/Users/ines/notes/Team/Q3 (2026)+[draft]/a.md')).toBe(true);
    expect(plain('/Users/ines/notes/Team/Q3 2026draft/a.md')).toBe(false);
  });

  it('PEOPLE-2.3: a pattern splits into the folder that can be resolved on disk and what is matched after it', () => {
    expect(literalPrefix('/Users/ines/notes/Team/Reviews')).toEqual({ folder: '/Users/ines/notes/Team/Reviews', rest: '' });
    expect(literalPrefix('/Users/ines/notes/Team/*/Reviews')).toEqual({ folder: '/Users/ines/notes/Team', rest: '*/Reviews' });
    expect(literalPrefix('/Users/ines/notes/Team/360 *')).toEqual({ folder: '/Users/ines/notes/Team', rest: '360 *' });
    expect(literalPrefix('/*/private')).toEqual({ folder: '/', rest: '*/private' });
  });
});
