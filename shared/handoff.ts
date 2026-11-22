/** HAND-3.2: the line after the Handover, asking the new Session to restate the work before it changes anything. */
export const HANDOFF_RESTATE_LINE = "In your first reply, before you change anything, say what the work is, where it stands and what you'll do first; then carry on.";

/** TOPIC-15.1: a Topic keeps a Handover's first this many characters. */
export const MAX_KEPT_HANDOVER = 20_000;
/** TOPIC-15.1: "What to hand off", as a Topic keeps it, at most. */
export const MAX_KEPT_PIECE = 2_000;

/**
 * TOPIC-15.1: the Handover in a start's prompt, as it was started (your edits in the launcher
 * included): its lines but the `Continued from:` line and HAND-3.2's restate line, trimmed, its
 * first 20,000 characters. '' when nothing else is left.
 */
export function handoverText(prompt: string): string {
  const kept = prompt
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^Continued from: \S/.test(line.trim()) && line.trim() !== HANDOFF_RESTATE_LINE);
  return kept.join('\n').trim().slice(0, MAX_KEPT_HANDOVER).trim();
}
