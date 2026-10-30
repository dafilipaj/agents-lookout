import { expect, it } from 'vitest';
import { unwrapPasted } from './pasted.ts';

const wrap = (id: string, body: string) => `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`;

it('shows a prompt that is all paste as the pasted text', () => {
  // Session 5fbe482f's shape: nothing typed around the paste.
  expect(unwrapPasted(`\n\n${wrap('34d8', 'Ok, šaljem formu.\nDrugi red')}\n`)).toBe('Ok, šaljem formu.\nDrugi red');
});

it('puts a paste back where it was typed, without the blank lines the tags added', () => {
  expect(unwrapPasted(`the comment is "\n\n${wrap('a1b2', 'Is this safe?')}\n\n". Should we?`)).toBe('the comment is "Is this safe?". Should we?');
  expect(unwrapPasted(`conflicts at \n\n${wrap('9f00', 'https://example.com/pr/6')}\n\n will ever`)).toBe('conflicts at https://example.com/pr/6 will ever');
  // This Session's (ee359ca4) shape: a line typed, then the paste.
  expect(unwrapPasted(`Findings:\n\n\n${wrap('6545', '1. one\n2. two')}\n`)).toBe('Findings:\n1. one\n2. two');
});

it('unwraps each of several pastes and keeps the paste as it was, $ and blank lines included', () => {
  // A line typed between two pastes: the tags' blank lines go, the typed line break stays.
  const text = `a\n\n${wrap('1111', 'first $1 $&')}\n\n\n\n\n${wrap('2222', 'second\n\nwith a gap\n')}\n`;
  expect(unwrapPasted(text)).toBe('afirst $1 $&\nsecond\n\nwith a gap\n');
  // Nothing typed between them: they join, as they were in the prompt.
  expect(unwrapPasted(`\n\n${wrap('1111', 'x')}\n\n\n\n${wrap('2222', 'y')}\n`)).toBe('xy');
});

it('keeps tags that only mention a paste: unmatched ids, an open tag alone, other values', () => {
  const mismatched = `\n\n<pasted_content id="aaaa">\nx\n</pasted_content id="bbbb">`;
  expect(unwrapPasted(mismatched)).toBe(mismatched);
  expect(unwrapPasted('wrapped in tags <pasted_content id="">')).toBe('wrapped in tags <pasted_content id="">');
  expect(unwrapPasted('plain')).toBe('plain');
  expect(unwrapPasted(null)).toBe(null);
  expect(unwrapPasted(42)).toBe(42);
});
