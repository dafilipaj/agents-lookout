import type { EvidenceReviewer, EvidenceRound, ReviewOutcome } from '../shared/evidence.ts';
import type { CommandRow } from './test-runs.ts';

/**
 * EVID-6.1, EVID-6.3: which runs reviewed a Session's work, and how they group into Review rounds.
 * Lookout's rule, constants in this one file (EVID-2.6's way), never a setting: there's no list
 * of review commands, Skills or models to keep.
 */

/** EVID-6.1: a word that starts with `review`, at a word's start, in any case; "preview" isn't one. */
export const REVIEW_WORD = /(?<![\p{L}\p{N}])review/iu;
/** EVID-6.5: a command or a description in the time's tooltip, whole up to this. */
const RUN_TEXT_MAX = 20_000;

/** Contract A2: a Subagent call, as Lookout reads it. */
export interface AgentRow {
  key: string;
  description: string | null;
  subagentType: string | null;
  model: string | null;
  effort: string | null;
  startedAt: number;
  /** When its end was recorded; while it runs, its launch's (A2). */
  timestamp: number;
  ended: 'completed' | 'failed' | 'stopped' | 'running';
}

/** EVID-6.2: a headless Codex or Claude Code Session, from `tb-session list --headless only`. */
export interface ReviewerSession {
  sessionId: string;
  harness: 'codex' | 'claude';
  /** Absolute, its trailing `/` dropped; null when tb-session gives none. */
  projectPath: string | null;
  createdAt: number;
  /** As `list` gives it, cut or not (Technical approach, "Review rounds"). */
  firstPrompt: string | null;
  transcriptMissing: boolean;
  /** Contract M1: from tb-session 0.6.0; null before. */
  model: string | null;
  effort: string | null;
}

/** EVID-6.1: one review run, a Subagent or a headless run. */
interface ReviewRun {
  key: string;
  start: number;
  /** Null while it runs. */
  end: number | null;
  outcome: ReviewOutcome;
  /** Its command, or its Subagent's description (its type without one). */
  text: string;
  reviewers: (ReviewerSession | { subagent: true; model: string | null })[];
}

const said = (text: string | null | undefined): boolean => !!text && REVIEW_WORD.test(text);
const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** EVID-6.1: the absolute paths a command's text holds, quotes stripped, a trailing `/` dropped. */
export function pathsIn(command: string): Set<string> {
  const out = new Set<string>();
  const bare = (text: string) => {
    for (const m of text.matchAll(/(?:^|[\s'"=(:])(\/[^\s'"`;|&<>()]+)/g)) out.add(trimSlash(m[1]!));
  };
  // A quoted path is whole, spaces included; a quoted command (`sh -c '…'`) holds bare paths too.
  for (const m of command.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const inner = m[1] ?? m[2] ?? '';
    if (inner.startsWith('/') && !inner.includes('\n')) out.add(trimSlash(inner));
    bare(inner);
  }
  bare(command);
  return out;
}

/** EVID-6.3: how a headless run ended, as its command did. */
function commandOutcome(row: CommandRow): ReviewOutcome {
  if (row.ended === 'running') return 'running';
  if (row.ended === 'timed_out') return 'timed-out';
  if (row.ended === 'interrupted') return 'stopped';
  if (row.ended === 'errored') return 'failed';
  if (row.exitCode === null) return 'unread';
  return row.exitCode === 0 ? 'finished' : 'failed';
}

const AGENT_OUTCOME: Record<AgentRow['ended'], ReviewOutcome> = { completed: 'finished', failed: 'failed', stopped: 'stopped', running: 'running' };

/**
 * EVID-6.1: the Session's review runs: its Subagents whose description or type says review, and
 * its commands that ran and started a reviewer, whose text or a reviewer's first prompt says it.
 */
export function reviewRuns(commands: readonly CommandRow[], agents: readonly AgentRow[], sessions: readonly ReviewerSession[], now: number): ReviewRun[] {
  const runs: ReviewRun[] = [];
  for (const a of agents) {
    if (!said(a.description) && !said(a.subagentType)) continue;
    const running = a.ended === 'running';
    runs.push({
      key: a.key,
      start: a.startedAt,
      end: running ? null : Math.max(a.startedAt, a.timestamp),
      outcome: AGENT_OUTCOME[a.ended],
      text: (a.description ?? a.subagentType ?? '').slice(0, RUN_TEXT_MAX),
      reviewers: [{ subagent: true, model: a.model }],
    });
  }
  for (const c of commands) {
    if (c.ended === 'refused' || c.startedAt == null) continue;
    const running = c.ended === 'running';
    // The window's ends are inclusive; a running command's ends now.
    const windowEnd = running ? Math.max(now, c.timestamp) : c.timestamp;
    const where = pathsIn(c.command);
    if (c.cwd) where.add(trimSlash(c.cwd));
    // A resumed Session was created before the command, so it's no reviewer of it.
    const reviewers = sessions.filter((s) => s.createdAt >= c.startedAt! && s.createdAt <= windowEnd && s.projectPath !== null && where.has(s.projectPath));
    if (!reviewers.length) continue;
    if (!said(c.command) && !reviewers.some((s) => said(s.firstPrompt))) continue;
    runs.push({
      key: c.key,
      start: c.startedAt,
      end: running ? null : Math.max(c.startedAt, c.timestamp),
      outcome: commandOutcome(c),
      text: c.command.slice(0, RUN_TEXT_MAX),
      reviewers: [...reviewers].sort((a, b) => a.createdAt - b.createdAt || a.sessionId.localeCompare(b.sessionId)),
    });
  }
  return runs;
}

/**
 * EVID-6.3: the runs whose windows overlap, one after another, as Review rounds, the latest start
 * first. A run that starts at or before the latest end so far joins that round.
 */
export function reviewRounds(runs: readonly ReviewRun[], now: number): EvidenceRound[] {
  const sorted = [...runs].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
  const groups: ReviewRun[][] = [];
  let latest = -Infinity;
  for (const run of sorted) {
    const end = run.end ?? Math.max(now, run.start);
    const group = groups.at(-1);
    if (group && run.start <= latest) {
      group.push(run);
      latest = Math.max(latest, end);
    } else {
      groups.push([run]);
      latest = end;
    }
  }
  return groups.map(round).sort((a, b) => b.start - a.start || a.key.localeCompare(b.key));
}

function round(runs: readonly ReviewRun[]): EvidenceRound {
  const running = runs.some((r) => r.outcome === 'running');
  const ended = runs.filter((r) => r.end !== null);
  const end = running ? null : Math.max(...ended.map((r) => r.end!));
  let outcome: ReviewOutcome;
  if (running) outcome = 'running';
  else if (runs.some((r) => r.outcome === 'finished')) outcome = 'finished';
  // The run that ended last decides; of two that ended together, the later-started.
  else outcome = ended.reduce((last, r) => (r.end! >= last.end! ? r : last)).outcome;
  const reviewers: EvidenceReviewer[] = [];
  const seen = new Map<string, EvidenceReviewer>();
  for (const run of runs) {
    for (const r of run.reviewers) {
      if ('subagent' in r) {
        // EVID-6.5: Subagents with the same words show once, with a count.
        const key = `subagent:${r.model ?? ''}`;
        const known = seen.get(key);
        if (known?.kind === 'subagent') known.count++;
        else {
          const reviewer: EvidenceReviewer = { kind: 'subagent', model: r.model, count: 1 };
          seen.set(key, reviewer);
          reviewers.push(reviewer);
        }
        continue;
      }
      // A reviewer of two commands of one round shows once.
      const key = `headless:${r.harness}:${r.sessionId}`;
      if (seen.has(key)) continue;
      const reviewer: EvidenceReviewer = { kind: 'headless', harness: r.harness, sessionId: r.sessionId, transcriptMissing: r.transcriptMissing, model: r.model, effort: r.effort };
      seen.set(key, reviewer);
      reviewers.push(reviewer);
    }
  }
  return {
    key: runs[0]!.key,
    outcome,
    start: Math.min(...runs.map((r) => r.start)),
    end,
    runs: runs.map((r) => r.text),
    reviewers,
  };
}
