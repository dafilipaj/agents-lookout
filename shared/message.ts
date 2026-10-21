/** A tab in a one-line message: typed, it would be the Tab key (VIEW-3). */
export const TAB_AS_SPACES = '    ';

/**
 * VIEW-3: a message's text as the server hands it to `fleet send`: line endings as `\n`, and a
 * one-line message's tabs as spaces, since one line is typed. Multi-line text is pasted, so its
 * tabs (Makefiles, Go, TSV) arrive intact. VIEW-3.8: the blanks before a leading `/` go, since
 * the Harness runs a slash command only when `/` comes first (` /model opus` is a prompt).
 * VIEW-1.13 compares a sent message with its copy this way.
 */
export function asSent(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^\s+(?=\/)/, '');
  return text.includes('\n') ? text : text.replace(/\t/g, TAB_AS_SPACES);
}
