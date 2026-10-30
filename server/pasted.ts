/**
 * Claude Code (2.1.314 at least) writes text pasted into its prompt to the Transcript, and so to
 * tb-session's `first_prompt`, wrapped in tags with blank lines around them:
 * `see \n\n<pasted_content id="34d8">\nPASTED\n</pasted_content id="34d8">\n\n here`.
 * Lookout shows a prompt as it was written: the pasted text in place, without the tags or the
 * line breaks they added. Only a pair whose ids agree is unwrapped, so a prompt that merely
 * mentions the tag keeps it. Any other value comes back as it is.
 */
const OPEN = '<pasted_content id="';
const PASTED = /(?:\n\n)?<pasted_content id="([^"\n]{1,64})">\n?([\s\S]*?)\n?<\/pasted_content id="\1">(?:\n\n|\n$)?/g;

export function unwrapPasted<T>(v: T): T {
  if (typeof v !== 'string' || !v.includes(OPEN)) return v;
  return v.replace(PASTED, (_, _id: string, body: string) => body) as T;
}
