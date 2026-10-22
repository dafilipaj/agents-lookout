/** VIEW-5.12: Fleet's limit on a Session's name (`MAX_TITLE` in its `title.rs`), in characters. */
export const MAX_NAME = 64;

/** Line breaks: a name is one line, as Fleet's `clean_title` requires. */
const LINE_BREAK = /[\r\n\u2028\u2029]/;
/** Other control characters: typed, they'd be keypresses (Tab, Esc, Ctrl-C). */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/**
 * VIEW-5.12: a new name for a Session, as the tab and the server both check it before it goes to
 * Fleet: trimmed, not empty, one line, no control characters, at most 64 characters counted as
 * Fleet counts them (Unicode code points; Fleet would cut a longer one short without a word).
 */
export function checkName(raw: string): NameCheck {
  const name = raw.trim();
  if (name === '') return { ok: false, message: 'Type a name first.' };
  if (LINE_BREAK.test(name)) return { ok: false, message: 'A name is one line, without line breaks.' };
  if (CONTROL.test(name)) return { ok: false, message: "The name has characters that can't be typed, such as tabs." };
  const length = [...name].length;
  if (length > MAX_NAME) return { ok: false, message: `A name is at most ${MAX_NAME} characters; this one has ${length}.` };
  return { ok: true, name };
}
