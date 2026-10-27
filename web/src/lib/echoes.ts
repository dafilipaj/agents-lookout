import { asSent } from '@shared/message.ts';
import type { ChatEntry, Status } from '@shared/types.ts';

/**
 * VIEW-1.13: how long a sent message waits for its copy from the Transcript while the Session is
 * Idle. The feed polls every second, so a copy normally arrives in 1–3 s; this outlasts a slow
 * Fleet call and the feed's retries (1 s, 2 s, then 5 s) several times over.
 */
export const ECHO_TIMEOUT_MS = 30_000;

/** VIEW-1.13: under a message whose copy never came, as for an answer Lookout can't be sure of (VIEW-4.3). */
export const NOT_TAKEN = 'It hasn’t reached the Transcript, so the Session may not have taken it. Check the terminal.';

/**
 * VIEW-1.13: under a slash command whose copy never came. Not a problem: Claude Code shows some
 * commands (`/usage`, `/status`) only in the terminal and writes nothing to the Transcript.
 */
export const IN_TERMINAL = 'This command’s result shows in the terminal.';

/** A message you sent from the composer, shown in the chat until its copy from the Transcript arrives. */
export interface Echo {
  id: number;
  text: string;
  /** When it was sent, ms since epoch (taken before the request went out). */
  at: number;
  /**
   * When its count toward ECHO_TIMEOUT_MS may start, ms: the send, then each time the chat can show
   * it again or a feed problem clears; null while it can't or one shows.
   */
  since: number | null;
  /**
   * `waiting`: shown, dimmed; a slash command goes once a prompt of yours that came after it
   * reaches the chat. `replaced`: its copy reached the chat; hidden, but kept while another message
   * is shown, so its copy isn't taken twice. `lost`: no copy came in ECHO_TIMEOUT_MS of Idle; shown
   * with NOT_TAKEN (IN_TERMINAL for a slash command) until a copy with its text comes, another
   * prompt of yours does, or a send succeeds.
   */
  state: 'waiting' | 'replaced' | 'lost';
}

/** The messages a Session view starts with, and shows while the chat can't. */
export const NO_ECHOES: readonly Echo[] = [];

export interface EchoContext {
  /** The chat's history, oldest first. */
  entries: readonly ChatEntry[];
  /** Prompts waiting in the Harness's queue. */
  queue: readonly ChatEntry[];
  status: Status;
  statusSince: number | null;
  /**
   * The chat can't show them: the Session reads as ended (a Codex id change reads so for a
   * moment), or its chat hasn't loaded (no Transcript, VIEW-1.8). Nothing is matched, and the
   * count starts again once the chat can show them.
   */
  hidden: boolean;
  /**
   * The chat shows a feed problem ("Couldn't read new messages", the Transcript gone): they show
   * and are matched, but don't time out, since a copy may be on its way; the count starts again
   * once it clears.
   */
  paused: boolean;
  now: number;
}

/**
 * Claude Code's `user` entries that aren't a prompt: Stop or Esc writes `[Request interrupted by
 * user]` (or `… for tool use`).
 */
const NOT_A_PROMPT = /^\[Request interrupted by user[^\]]*\]$/;

/**
 * VIEW-1.13: the messages after matching them against the chat, oldest first; the same array when
 * nothing changed, and empty once every one is replaced. A message's copy is a prompt of yours (a
 * `user` or `command` entry, in the history or the queue) written at or after its send.
 */
export function settleEchoes(echoes: readonly Echo[], c: EchoContext): readonly Echo[] {
  if (echoes.length === 0) return echoes;
  if (c.hidden) return update(echoes, (e) => (e.since === null ? e : { ...e, since: null }));
  const copies = prompts(c.entries, c.queue);
  /** For each copy taken, the message that took it, by index. */
  const takenBy = new Map<number, number>();
  const found = new Set<number>();
  const take = (i: number, match: (p: Copy) => boolean) => {
    const e = echoes[i]!;
    const k = copies.findIndex((p, k) => !takenBy.has(k) && p.at >= e.at && match(p));
    if (k < 0) return;
    takenBy.set(k, i);
    found.add(i);
  };

  // By text: in send order, each message takes the first copy with its text.
  echoes.forEach((e, i) => {
    const text = normal(e.text);
    take(i, (p) => p.text === text);
  });
  // By time: each message still without one takes the first left over, whatever its text. Not a
  // lost one, nor a slash command: some write nothing to the Transcript, so it would take a later
  // message's copy.
  echoes.forEach((e, i) => {
    if (!found.has(i) && e.state !== 'lost' && !isCommand(e.text)) take(i, () => true);
  });

  // Passed over: a slash command still waiting once a prompt of yours that came after it reaches the
  // chat: written at or after its send and not an earlier message's copy, a later one's included.
  // The Harness takes input in order, so nothing more will come for it (`/status` writes nothing,
  // Codex's `/init` a prompt with other text). It goes without a line, so it doesn't open the
  // preview either; a copy written late (`/compact`'s) then shows in its own place.
  /** Copy `k` is the copy of a message sent before message `i`. */
  const earlier = (k: number, i: number) => (takenBy.get(k) ?? i) < i;
  const passedOver = (e: Echo, i: number) =>
    !found.has(i) && e.state === 'waiting' && isCommand(e.text) && copies.some((p, k) => p.at >= e.at && !earlier(k, i));
  // Overtaken: a lost message once a prompt of yours written at or after its send is left over.
  // Another message's copy doesn't count, so one a hook blocked keeps its line under the next turn.
  const overtaken = (e: Echo, i: number) => !found.has(i) && e.state === 'lost' && copies.some((p, k) => !takenBy.has(k) && p.at >= e.at);

  // Settle: replaced, gone, or waiting until ECHO_TIMEOUT_MS of Idle turns it lost.
  const result = update(echoes, (e, i) => {
    if (passedOver(e, i)) return null;
    if (overtaken(e, i)) return null;
    const since = c.paused ? null : (e.since ?? c.now);
    const state = found.has(i) ? 'replaced' : e.state === 'waiting' && since !== null && expired(since, c) ? 'lost' : e.state;
    return state === e.state && since === e.since ? e : { ...e, since, state };
  });
  return result.every((e) => e.state === 'replaced') ? NO_ECHOES : result;
}

/** The messages the chat shows: waiting for their copy, or lost. */
export function shown(echoes: readonly Echo[]): Echo[] {
  return echoes.filter((e) => e.state !== 'replaced');
}

/**
 * A slash command (`/usage`, `/review 42`): it pairs only with a copy of its own text. VIEW-9.7: a
 * first word holding a second `/` is a path, not a command; a backslash keeps the character after
 * it in the word, so an inserted `/My\ Folder/shot.png` (VIEW-9.6) is one word, and a path.
 */
export function isCommand(text: string): boolean {
  return /^\/(?:\\[^/]|[^\s/\\])*(?:\s|\\?$)/.test(normal(text));
}

interface Copy {
  /** When it was written, ms. */
  at: number;
  text: string;
}

/** `echoes` with `f` applied to each, null dropping one; the same array when nothing changed. */
function update(echoes: readonly Echo[], f: (e: Echo, i: number) => Echo | null): readonly Echo[] {
  let next: Echo[] | null = null;
  echoes.forEach((e, i) => {
    const out = f(e, i);
    if (out !== e) next ??= echoes.slice(0, i);
    if (next && out) next.push(out);
  });
  return next ?? echoes;
}

function expired(since: number, c: EchoContext): boolean {
  if (c.status !== 'idle') return false;
  return c.now - Math.max(since, c.statusSince ?? since) >= ECHO_TIMEOUT_MS;
}

/**
 * How a message and its copy are compared: as the server sends it, trimmed, and as Fleet records
 * a command: shell mode's `!cmd` as `! cmd`, and a slash command's name and arguments one space
 * apart (`/review  42` as `/review 42`).
 */
function normal(text: string): string {
  return asSent(text)
    .trim()
    .replace(/^!\s*(?=\S)/, '! ')
    .replace(/^(\/\S+)\s+/, '$1 ');
}

/** Your prompts in the chat, oldest first; entries without a time and interrupt markers left out. */
function prompts(entries: readonly ChatEntry[], queue: readonly ChatEntry[]): Copy[] {
  const out: Copy[] = [];
  for (const e of [...entries, ...queue]) {
    if (e.kind !== 'user' && e.kind !== 'command') continue;
    const text = normal(e.text);
    if (e.kind === 'user' && NOT_A_PROMPT.test(text)) continue;
    const at = e.ts ? Date.parse(e.ts) : Number.NaN;
    if (!Number.isNaN(at)) out.push({ at, text });
  }
  return out.sort((a, b) => a.at - b.at);
}
