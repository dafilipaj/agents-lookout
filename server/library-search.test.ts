import { expect, it } from 'vitest';
import { foldLibraryText, libraryMatches } from '../shared/library-search.ts';

it('LIB-2.4: Unicode search folds case, sigma variants and expanding letters without depending on the browser locale', () => {
  for (const [text, query] of [['CAFÉ', 'café'], ['ΟΣ', 'ος'], ['οσ', 'ος'], ['Straße', 'STRASSE'], ['ﬃ', 'FFI'], ['İ', 'i\u0307'], ['𐐀', '𐐨']]) {
    expect(foldLibraryText(text!)).toBe(foldLibraryText(query!));
  }
  expect(foldLibraryText('I')).toBe('i');
  expect(foldLibraryText('ı')).not.toBe(foldLibraryText('I'));
  expect(foldLibraryText('[A].*')).toBe('[a].*');
});

it('LIB-2.4: search marks use original string ranges when case folding expands a letter or crosses a surrogate pair', () => {
  expect(libraryMatches('aİb Straße ﬃ 𐐀z', 'i\u0307')).toEqual([[1, 2]]);
  expect(libraryMatches('aİb Straße ﬃ 𐐀z', 'SS')).toEqual([[8, 9]]);
  expect(libraryMatches('aİb Straße ﬃ 𐐀z', 'ffi')).toEqual([[11, 12]]);
  expect(libraryMatches('aİb Straße ﬃ 𐐀z', '𐐨')).toEqual([[13, 15]]);
  expect(libraryMatches('xßy', 's')).toEqual([[1, 2]]);
  expect(libraryMatches('aİb', 'ib')).toEqual([]);
  expect(libraryMatches('aİb', 'i')).toEqual([[1, 2]]);
  expect(libraryMatches('Ος οσ', 'οσ')).toEqual([[0, 2], [3, 5]]);
  expect(libraryMatches('x [A].* y [a].*', '[a].*')).toEqual([[2, 7], [10, 15]]);
  expect(libraryMatches('anything', '')).toEqual([]);
});
