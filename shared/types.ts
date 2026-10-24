import type { LaunchHarness, SettingsView } from './settings.ts';
import type { MemorySnapshot } from './memory.ts';
import type { UsageSnapshot } from './usage.ts';
import type { WorkSnapshot } from './work.ts';

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
  /** SIDE-2.9: the absolute common git dir, what tells two checkouts of one repo from two repos. */
  commonDir: string;
  /** SIDE-2.8: the repo's default branch (`origin/HEAD`, else a local `main`, else `master`); null when unknown. */
  defaultBranch: string | null;
}

/** SIDE-2.7, 2.9: which parts of a row's location its second line shows, decided by the server. */
export interface LocationShown {
  /** The repo name (or, outside git, the working directory's name). */
  repo: boolean;
  /** The Worktree or branch. */
  where: boolean;
}

/** One sidebar row, as the server sends it to the UI. */
export interface SessionRow {
  /** `session_id` when present, otherwise `<harness>:<pid>`. */
  id: string;
  pid: number;
  memoryGrowthBytes: number | null;
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
  /** SIDE-2.7–2.9: what of the location the row shows; the rest is in its tooltip and the status line. */
  locationShown: LocationShown;
  backend: Backend;
  controllable: boolean;
  /**
   * VIEW-5.6: hosted in a tmux session of its own, as far as `fleet list` tells: backend tmux and
   * no other listed Session in that tmux session. Fleet's `close` refuses a shared one anyway.
   */
  ownHost: boolean;
  model: string | null;
  /** VIEW-5.11: the Session's Effort as Fleet read it (`high`, `xhigh` …); null when unknown. */
  effort: string | null;
  /** SIDE-9, VIEW-8: running now and finished in this Turn; null when Fleet can't tell. */
  subagents: { running: number; finished: number } | null;
  /** SIDE-2.11: what a Busy Session is doing now, one line, at most 120 characters; null otherwise. */
  activity: string | null;
  /**
   * SIDE-2.6, VIEW-5.16: Idle with a background shell command still running (Fleet's `shell`
   * status, from Claude Code 2.1.308). Always false for any other Status.
   */
  backgroundShell: boolean;
  /**
   * VIEW-5.6: the agent process's start time (RFC 3339, UTC) as Fleet read it; null when it
   * couldn't. With `pid` it names this process generation, so End Session never closes a
   * replacement (a resume under a new process, or a reused pid).
   */
  procStart: string | null;
  /**
   * VIEW-6.7: the model a switch from Lookout moved this Session's process to, until a reply after
   * it reaches the Transcript (Fleet's `model` follows only then); null otherwise.
   */
  pendingModel: PendingModel | null;
  /**
   * VIEW-7.7: the Effort a switch from Lookout moved this Session's process to, until a reply after
   * it reaches the Transcript (Fleet's `effort` follows only then, dated by `model_at` as the model
   * is); null otherwise.
   */
  pendingEffort: PendingEffort | null;
  /**
   * VIEW-6.8: when the reply Fleet's `model` came from reached the Transcript (Fleet's `model_at`,
   * RFC 3339); null without one. It moves with every reply, whatever its model.
   */
  modelAt: string | null;
}

/** VIEW-6.7: a switch Fleet confirmed: `model` from the Session's next reply on, `since` the switch's Transcript time. */
export interface PendingModel {
  model: string;
  since: string;
}

/** VIEW-7.7: a switch Fleet confirmed: `effort` from the Session's next reply on, `since` the switch's Transcript time. */
export interface PendingEffort {
  effort: string;
  since: string;
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
  models: HarnessModel[];
}

/** A model a Harness offers (LAUNCH-3.2), with its Effort levels (VIEW-7.1). */
export interface HarnessModel {
  id: string;
  label: string;
  /** VIEW-7.1: Fleet's `efforts`, lowest first; [] where Fleet lists none (an older Fleet). */
  efforts: string[];
  /** Fleet's `default_effort`: the level a new Session on it starts at; null when unknown. */
  defaultEffort: string | null;
}

/** What the launcher sends to `POST /api/launch`. */
export interface LaunchRequest {
  /** LAUNCH-3.4: one of the chosen model's levels; absent when none is picked. */
  effort?: string;
  /** LAUNCH-3.5: false when absent. */
  skipPermissions?: boolean;
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
      settings: SettingsView;
      launches: LaunchView[];
      /** Starts completed in the last 60 s, so a tab that reconnects can still select its Session. */
      started: { launchId: string; sessionId: string }[];
      /** This event stream's id: the tab names it when it says what it views (`PUT /api/watch`). */
      clientId: string;
      /** USAGE: the latest numbers, or null before the first read. */
      usage: UsageSnapshot | null;
      memory: MemorySnapshot | null;
      /**
       * WORK: the latest PRs and Tasks, and when Refresh is back. This server always
       * sends it; it's optional only so that UI tests can leave it out.
       */
      work?: WorkSnapshot;
    }
  /** USAGE: new numbers (sent to every tab, only when they changed). */
  | { type: 'usage'; usage: UsageSnapshot }
  | { type: 'memory'; memory: MemorySnapshot }
  /** WORK: the latest PRs, Tasks and Refresh state (sent to every tab, only when something changed). */
  | { type: 'work'; work: WorkSnapshot }
  /** VIEW-2: what the Session's terminal shows, as plain text; sent only to tabs previewing it. */
  | { type: 'preview'; sessionId: string; text: string | null; error: string | null }
  /** `started`: launches Fleet now reports, and the Session each became. */
  | { type: 'launches'; launches: LaunchView[]; started: { launchId: string; sessionId: string }[] }
  | { type: 'sessions'; upsert: SessionRow[]; remove: string[] }
  | { type: 'fleet'; fleet: FleetHealth }
  | { type: 'settings'; settings: SettingsView }
  /**
   * VIEW-4: the prompt the Session's terminal shows, read with `fleet answer --list` while a tab
   * views it and it Needs you; sent only to the tabs viewing it, only when it changed. `epoch` is
   * the server's answer epoch when the read began (see `AnswerResult`); an answer goes back with
   * it. `uncertain`: an answer whose outcome Lookout can't tell was for this prompt (`p:<id>`) or
   * question (`q:<id>`), so no tab offers to answer it again. `since`: the Needs you spell the read
   * was made in (the row's `statusSince` when it began), null when nothing was read (VIEW-4.5).
   * `answerable`, `detail`, `pane`: whether Fleet could answer it now, why not, and the terminal's
   * size (VIEW-4.6); `false`, null, null when nothing was read or the read failed. `oldFleet`: the
   * read came from a Fleet older than Lookout's pin, which says nothing of `answerable` (VIEW-4.6).
   */
  | {
      type: 'prompt';
      sessionId: string;
      prompt: ScreenPrompt | null;
      epoch: number;
      uncertain?: string | null;
      since?: number | null;
      answerable?: boolean;
      detail?: AnswerDetail | null;
      pane?: PaneSize | null;
      oldFleet?: boolean;
    }
  | ChatEvent;

/**
 * VIEW-4.2: what `fleet answer --list` read off the terminal, validated and bounded by the server.
 * - `permission`: a permission prompt (Claude Code) or approval (Codex), its choices in the
 *   terminal's wording; `untouched` while its cursor is still on the first choice.
 * - `incomplete`: a permission prompt Fleet can't read whole; it must be answered in the terminal.
 * - `question`: an AskUserQuestion form; its options come from the chat's question (VIEW-4.1).
 */
export type ScreenPrompt =
  | { kind: 'permission'; id: string; title: string; detail: string[]; choices: PromptChoice[]; untouched: boolean }
  | { kind: 'incomplete' }
  | { kind: 'question'; id: string | null; untouched: boolean };

/**
 * VIEW-4.6: why Fleet can't answer the prompt on screen now (`answer --list`'s `detail`, the fork's
 * fixed set; never screen text). `no_form`: no form of that kind; `clipped`: not all of it on
 * screen (taller than the terminal); `layout_unsupported`: a layout Fleet doesn't read; `tabs`,
 * `question`, `options`, `different_prompt`: another form; `touched`, `cursor_moved`: started in
 * the terminal.
 */
export type AnswerDetail = 'no_form' | 'clipped' | 'layout_unsupported' | 'tabs' | 'question' | 'options' | 'touched' | 'cursor_moved' | 'different_prompt';
export const ANSWER_DETAILS: readonly AnswerDetail[] = ['no_form', 'clipped', 'layout_unsupported', 'tabs', 'question', 'options', 'touched', 'cursor_moved', 'different_prompt'];

/** The terminal's size, in characters (`answer`'s `pane`). */
export interface PaneSize {
  cols: number;
  rows: number;
}

/** One choice of a permission prompt: its number on screen and its wording. */
export interface PromptChoice {
  n: number;
  label: string;
}

/** VIEW-4.1: the answer to one question: 0-based option indexes, and/or typed text. */
export interface QuestionAnswer {
  options: number[];
  text?: string;
}

/**
 * VIEW-4: `POST /api/sessions/:id/answer`'s body. `epoch` is that of the read it answers (the
 * `prompt` event's): the server refuses an answer read before the Session's last one.
 */
export type AnswerRequest =
  /** A choice of the permission prompt `prompt` (its id from `--list`), never of another one. */
  | { kind: 'permission'; prompt: string; choice: number; epoch: number }
  /** The pending AskUserQuestion `question` (its tool_use id), one answer per question. */
  | { kind: 'question'; question: string; answers: QuestionAnswer[]; epoch: number };

/**
 * VIEW-4: an answer Fleet typed. `epoch` is the server's answer epoch after it: a `prompt` event
 * with a lower epoch was read before the answer landed, so its buttons are stale.
 */
export interface AnswerResult {
  epoch: number;
}

/**
 * VIEW-4.4/4.5: the Status Esc is pressed for: `busy` is Stop, `needs-you` the Esc button. The
 * server presses only while a fresh list still has the Session in it.
 */
export type EscStatus = Extract<Status, 'busy' | 'needs-you'>;

/**
 * VIEW-3.7: why Fleet held a send (`fleet send --require-empty`): text in the input box, a prompt
 * waiting in its place, no input box on screen, or one Fleet can't read. Nothing was typed.
 */
export type HeldReason = 'text' | 'prompt' | 'no_input_box' | 'unreadable';
export const HELD_REASONS: readonly HeldReason[] = ['text', 'prompt', 'no_input_box', 'unreadable'];

/**
 * VIEW-1: one chat entry, from `fleet messages --json` (Transcript order). Kinds Lookout doesn't
 * know are dropped on the server; Fleet never emits thinking, hooks, sidechains or tool output.
 */
export type ChatEntry =
  | { kind: 'user'; cursor: string; ts: string | null; text: string; queued: boolean }
  | { kind: 'assistant'; cursor: string; ts: string | null; text: string; final: boolean }
  /** A slash command or `!` shell line typed into the Session. */
  | { kind: 'command'; cursor: string; ts: string | null; text: string }
  /** VIEW-1.3: a subagent's result, Claude Code's task notification summary (e.g. `Agent "Build" finished`). */
  | { kind: 'system'; cursor: string; ts: string | null; text: string }
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

/**
 * HIST-2: one past Session, from `tb-session list|search --json`, validated and bounded by the
 * server. Whether it's live is the tab's call, from the Session list it already has (HIST-3.2).
 */
export interface HistoryItem {
  sessionId: string;
  harness: Harness;
  /** Started without a terminal (Glossary: Headless Session); null when tb-session doesn't know. */
  headless: boolean | null;
  /** Its summary, or else its first prompt. */
  title: string;
  /** The directory it started in; null when tb-session doesn't know. */
  projectPath: string | null;
  /** HIST-2.9: `projectPath` as shown, the home directory as `~`. */
  projectDisplay: string | null;
  /** The start directory's name. */
  repo: string | null;
  branch: string | null;
  /** When it was last active, ms since epoch. */
  lastActiveAt: number | null;
  /** Where the search matched, `«` and `»` around the hits; null when listing. */
  snippet: string | null;
  /**
   * HIST-2.9: its first prompt, its first three lines, at most 600 characters; null when the row
   * has none (a tb-session 0.2 `list` row), which the expanded result reads with `show`.
   */
  firstPrompt: string | null;
  /** Why it can't be resumed (HIST-3.3); null when it can. */
  blocked: HistoryBlock | null;
}

/** Why a past Session can't be resumed. */
export type HistoryBlock = 'folder-gone' | 'transcript-missing' | 'no-folder';

/** `GET /api/history`: a page of past Sessions, or how to install tb-session. */
export type HistoryPage =
  | { state: 'ok'; items: HistoryItem[]; page: number; hasMore: boolean }
  | { state: 'not-installed'; installCommand: string };

/** HIST-3.3: a past Session that can't be resumed, read-only: its latest messages. */
export interface HistoryDetail {
  item: HistoryItem;
  entries: ChatEntry[];
  /** `index`: its Transcript is gone, and the messages come from tb-session's search index. */
  source: 'transcript' | 'index';
  /**
   * Which messages these are: the latest (tb-session 0.3, `--tail`), or, from a tb-session 0.2
   * that can't tail, its first ones (`first`) or every one it has (`all`).
   */
  preview: 'latest' | 'first' | 'all';
  /** How many messages the Session has, when tb-session says. */
  totalMessages: number | null;
}

/**
 * HIST-2.9, HIST-2.10: `GET /api/history/:harness/:id/peek`, what an expanded result reads with one
 * `tb-session show --tail 1`: its first prompt and its last message, each its first three lines.
 */
export interface HistoryPeek {
  firstPrompt: string | null;
  /** The last prompt or reply, and who said it; null when there is none, or with tb-session 0.2. */
  last: { role: 'user' | 'assistant'; text: string } | null;
  /** False with tb-session 0.2, which can't tail: the last message is left out. */
  tailed: boolean;
}

/**
 * VIEW-5.6: `POST /api/sessions/:id/end`'s body: the process the user confirmed ending, from the
 * row the dialog opened on. Fleet closes only that process (`--expect-pid`, `--expect-start`).
 */
export interface EndTarget {
  pid: number;
  procStart: string | null;
}

/**
 * VIEW-5.14: `POST /api/sessions/:id/rename`: Fleet typed the Harness's `/rename`. `renamed`: the
 * Session's registry shows the name; `sent`: it doesn't yet. Either way the new title comes back
 * through `fleet list`.
 */
export interface RenameResult {
  result: 'renamed' | 'sent';
}

/**
 * VIEW-6: `POST /api/sessions/:id/model`: the model to switch to, and the process the menu was
 * opened on, so a replacement is never the one switched.
 */
export interface ModelSwitchRequest extends EndTarget {
  model: string;
}

/** VIEW-6.5: the switch is done; `confirmed` when Claude Code asked to confirm it and the pick answered. */
export interface ModelSwitchResult {
  model: string;
  confirmed: boolean;
}

/**
 * VIEW-7: `POST /api/sessions/:id/effort`: the level to switch to, and the process the menu was
 * opened on, so a replacement is never the one switched.
 */
export interface EffortSwitchRequest extends EndTarget {
  effort: string;
}

/**
 * VIEW-7.5: the switch is done; `confirmed` when Claude Code asked to confirm it and the pick
 * answered; `saved` when Claude Code says it also became its default for new Sessions (Fleet's
 * `saved`: false for `max`, this Session only).
 */
export interface EffortSwitchResult {
  effort: string;
  confirmed: boolean;
  saved: boolean;
}

/** VIEW-5.6: `POST /api/sessions/:id/end`: how the Session ended. */
export interface EndResult {
  /** `exit`: on its Harness's own exit command; `killed`: its Session host was closed with it. */
  how: 'exit' | 'killed';
}

/** `POST /api/history/resume`: a start like LAUNCH's, or the live Session to select instead. */
export type ResumeResult =
  | { kind: 'started'; launch: LaunchView }
  | { kind: 'live'; sessionId: string }
  /** HIST-3.3: it can't be resumed after all (its start directory went since the listing, say). */
  | { kind: 'blocked'; harness: Harness; sessionId: string; blocked: HistoryBlock };
