import type { LaunchHarness, Settings } from './settings.ts';
import type { UsageSnapshot } from './usage.ts';

/** The agent CLI a Session runs (Glossary: Harness). pi is a non-goal and is filtered out. */
export type Harness = 'claude' | 'codex';

/** Glossary: Status. Dormant belongs to HIST, not to the live sidebar. */
export type Status = 'needs-you' | 'busy' | 'idle' | 'unknown';

/** The terminal Fleet found the Session in. `tmux` and `iterm` mean Controllable. */
export type Backend = 'tmux' | 'iterm' | 'unknown';

/** Where a Session works, read from `git -C <cwd>`. */
export interface GitLocation {
  /** Repo name: the common git dir's parent. */
  repo: string;
  /** Linked Worktree name (basename of the top level), or null in the main checkout. */
  worktree: string | null;
  /** Current branch; a short commit hash when HEAD is detached; null when unknown. */
  branch: string | null;
}

/** One sidebar row, as the server sends it to the UI. */
export interface SessionRow {
  /** `session_id` when present, otherwise `<harness>:<pid>`. */
  id: string;
  pid: number;
  harness: Harness;
  title: string;
  status: Status;
  /** What a Needs you Session is waiting for; null otherwise. */
  waitingFor: string | null;
  /** Last status change, ms since epoch. */
  statusSince: number | null;
  /** Context usage percentage; null when Fleet doesn't report it. */
  contextPct: number | null;
  cwd: string | null;
  /** null: not a git directory (or not read yet). */
  git: GitLocation | null;
  backend: Backend;
  controllable: boolean;
  model: string | null;
}

/** The health of the `fleet list` poll. */
export type FleetHealth =
  | { state: 'starting' }
  | { state: 'ok' }
  | { state: 'not-installed'; installCommand: string }
  /** Polls fail or time out; the last good list stays. `lastOkAt` is null when no poll ever succeeded. */
  | { state: 'failing'; lastOkAt: number | null; error: string };

/** A Harness Lookout can start, from `fleet harness list --json` (LAUNCH-3). */
export interface HarnessOption {
  id: LaunchHarness;
  label: string;
  installed: boolean;
  /** The first, with id '', is the Harness's own default. */
  models: { id: string; label: string }[];
}

/** What the launcher sends to `POST /api/launch`. */
export interface LaunchRequest {
  directory: string;
  harness: LaunchHarness;
  /** '' for the Harness's own default. */
  model: string;
  name: string;
  prompt: string;
}

/** A start in flight: a "Starting…" row until Fleet reports the Session (LAUNCH-4). */
export interface LaunchView {
  id: string;
  title: string;
  harness: LaunchHarness;
  directory: string;
  startedAt: number;
  /** `failed`: not reported by Fleet within 15 s; its Session host is left running. */
  state: 'starting' | 'failed';
  error: string | null;
  /** The last lines of its terminal, once failed. */
  terminal: string[] | null;
}

/** Events the server pushes over SSE (`/api/events`). */
export type ServerEvent =
  | {
      type: 'snapshot';
      sessions: SessionRow[];
      fleet: FleetHealth;
      settings: Settings;
      launches: LaunchView[];
      /** Starts completed in the last 60 s, so a tab that reconnects can still select its Session. */
      started: { launchId: string; sessionId: string }[];
      /** This event stream's id: the tab names it when it says what it views (`PUT /api/watch`). */
      clientId: string;
      /** USAGE: the latest numbers, or null before the first read. */
      usage: UsageSnapshot | null;
    }
  /** USAGE: new numbers (sent to every tab, only when they changed). */
  | { type: 'usage'; usage: UsageSnapshot }
  /** VIEW-2: what the Session's terminal shows, as plain text; sent only to tabs previewing it. */
  | { type: 'preview'; sessionId: string; text: string | null; error: string | null }
  /** `started`: launches Fleet now reports, and the Session each became. */
  | { type: 'launches'; launches: LaunchView[]; started: { launchId: string; sessionId: string }[] }
  | { type: 'sessions'; upsert: SessionRow[]; remove: string[] }
  | { type: 'fleet'; fleet: FleetHealth }
  | { type: 'settings'; settings: Settings }
  | ChatEvent;

/**
 * VIEW-1: one chat entry, from `fleet messages --json` (Transcript order). `system` entries are
 * dropped on the server; Fleet never emits thinking, hooks, sidechains or tool output.
 */
export type ChatEntry =
  | { kind: 'user'; cursor: string; ts: string | null; text: string; queued: boolean }
  | { kind: 'assistant'; cursor: string; ts: string | null; text: string; final: boolean }
  /** A slash command or `!` shell line typed into the Session. */
  | { kind: 'command'; cursor: string; ts: string | null; text: string }
  /** No tool output, ever: the tool and one short argument. */
  | { kind: 'tool_call'; cursor: string; ts: string | null; id: string; tool: string; summary: string }
  | {
      kind: 'question';
      cursor: string;
      ts: string | null;
      id: string;
      questions: ChatQuestion[];
      /** `abandoned`: never answered, and a later prompt moved the conversation on. */
      status: 'pending' | 'answered' | 'declined' | 'abandoned';
      answer: ChatAnswer | null;
    };

/** Claude Code's AskUserQuestion, as Fleet normalizes it. */
export interface ChatQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

/**
 * What became of a question: per question, in order, the answer text as recorded (null: none)
 * and the indexes of the options it picked (empty for a typed answer); or declined.
 */
export type ChatAnswer = { answers: (string | null)[]; picked: number[][] | null } | { declined: true };

/** Why the chat can't be shown in full: no Transcript was found, or reading it failed. */
export interface ChatProblem {
  kind: 'missing' | 'failed';
  message: string;
}

/**
 * VIEW-1.4: chat updates, sent only to the tabs viewing that Session.
 * - `reset`: the latest entries; replaces what the tab has (first load, or the Transcript was
 *   rewritten). `before` is the cursor for "Show earlier"; null at the Transcript's start.
 * - `append`: newer entries, in order; `updated` replaces entries already shown, by cursor (a
 *   question answered, a reply that grew); `queue` replaces the queue.
 * - `queue` (both): prompts typed while the agent was busy and not taken yet, shown after the
 *   entries. Never part of the history: once taken, a prompt arrives as a normal entry.
 * - `problem`: the Transcript is missing or unreadable; null once it's fine again. Entries
 *   already shown stay.
 */
export type ChatEvent =
  | { type: 'chat'; sessionId: string; op: 'reset'; entries: ChatEntry[]; before: string | null; queue: ChatEntry[] }
  | { type: 'chat'; sessionId: string; op: 'append'; entries: ChatEntry[]; updated: ChatEntry[]; queue: ChatEntry[] }
  | { type: 'chat'; sessionId: string; op: 'problem'; problem: ChatProblem | null };

/** VIEW-1.6: a page of older entries, from `GET /api/sessions/:id/messages?before=`. */
export interface ChatPage {
  entries: ChatEntry[];
  before: string | null;
}
