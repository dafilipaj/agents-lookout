/**
 * EVID: what backs a Session's work when it stops, as the server works it out from the Session's
 * commands (tb-session) and its Changes (DIFF), and as the tabs show it.
 */

/** EVID-3.3: the verdict's rows, in the table's order. */
export type VerdictKey = 'no-run' | 'running' | 'changed' | 'passed' | 'failed' | 'timed-out' | 'stopped' | 'no-tests' | 'unread';
export type VerdictTone = 'ok' | 'warning' | 'quiet';

/** EVID-2.3: how a Test run ended, by the word the popover shows (EVID-5.11): `stopped` is `interrupted`, `unread` is unknown. */
export type RunOutcome = 'passed' | 'failed' | 'timed-out' | 'stopped' | 'no-tests' | 'running' | 'unread';

/** EVID-3.3: the verdict, in words, short for the status line, and its tone. */
export interface RowEvidence {
  verdict: VerdictKey;
  tone: VerdictTone;
  /** The verdict in words: "Changed after its last test run"; EVID-3.4's "last readable" included. */
  text: string;
  /** For the status line: "Changed since tests". */
  short: string;
}

const VERDICTS: Record<VerdictKey, { text: string; short: string; tone: VerdictTone }> = {
  'no-run': { text: 'No test run', short: 'No test run', tone: 'warning' },
  running: { text: 'A test run is still running', short: 'Tests running', tone: 'quiet' },
  changed: { text: 'Changed after its last test run', short: 'Changed since tests', tone: 'warning' },
  passed: { text: 'Tests passed after its last change', short: 'Tests passed', tone: 'ok' },
  failed: { text: 'Its last test run failed', short: 'Tests failed', tone: 'warning' },
  'timed-out': { text: 'Its last test run timed out', short: 'Tests timed out', tone: 'warning' },
  stopped: { text: 'Its last test run was stopped', short: 'Tests stopped', tone: 'warning' },
  'no-tests': { text: 'Its last test run ran no tests', short: 'No tests ran', tone: 'warning' },
  unread: { text: 'No readable test result after its last change', short: 'Result unread', tone: 'warning' },
};

/** EVID-3.3, EVID-3.4: a verdict's words; `readable` says "its last readable test run" for a later unread run. */
export function verdict(key: VerdictKey, readable = false): RowEvidence {
  const v = VERDICTS[key];
  return { verdict: key, tone: v.tone, short: v.short, text: readable ? v.text.replace('Its last test run', 'Its last readable test run') : v.text };
}

/** EVID-5.11: one Test run, as the popover lists it. */
export interface EvidenceRun {
  /** Its row's `tool_use_id`, unique within the Session. */
  key: string;
  /** EVID-2.5: when it ended, ms since epoch. */
  end: number;
  outcome: RunOutcome;
  /** EVID-2.3: its summary lines' numbers, summed; null without a summary line. */
  passed: number | null;
  failed: number | null;
  /** The command, whole up to 20,000 characters. */
  command: string;
  /** A Subagent ran it. */
  subagent: boolean;
}

/** EVID-5.10: a changed file with a modification time later than the last pass. */
export interface EvidenceFile {
  /** Its Checkout's root, which DIFF-4's open names. */
  root: string;
  /** Its Checkout's id (PLAIN-6.1), which the Spec view's path names for a `.plain` file (PLAIN-3.1). */
  checkout: string;
  path: string;
  mtime: number;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** EVID-4.2: the Session's test files among its Changes. */
export interface TestFiles {
  count: number;
  added: number;
  deleted: number;
  additions: number;
  deletions: number;
}

/** EVID-5.2: a Session's Evidence, sent to every tab when it changes (`evidence` event). */
export interface EvidenceView {
  sessionId: string;
  verdict: RowEvidence;
  /** EVID-5.2: when Lookout last read the Session's commands, ms since epoch. */
  readAt: number;
  /** EVID-1.8: why the latest read failed; null when it worked. The verdict is then from `readAt`'s read. */
  error: string | null;
  /** EVID-3.1: the latest modification time of the changed files; null when none has one. */
  lastChange: number | null;
  /** EVID-5.3: the latest Test run that passed; null without one. */
  lastPass: { end: number; passed: number | null } | null;
  /** EVID-5.3: how many Test runs there are in all. */
  runCount: number;
  /** EVID-5.3: changed files with a modification time later than the last pass (every one with a time, without a pass). */
  changedSince: number;
  /** EVID-5.10: the first 10 of them, the latest change first; empty without a pass. */
  changedSinceFiles: EvidenceFile[];
  /** EVID-5.4 */
  testFiles: TestFiles;
  /** EVID-5.4: every changed file DIFF counts, those it left out included. */
  changedFiles: number;
  /** EVID-5.2: the changed files DIFF listed; less than `changedFiles` when it left some out (DIFF-2.7). */
  listedFiles: number;
  /** EVID-5.11: every Test run, newest first. */
  runs: EvidenceRun[];
}

/** EVID-5.11: the label's note: "12 · 2 failed · 1 unread", each part left out at 0. */
export function runsNote(runs: readonly Pick<EvidenceRun, 'outcome'>[]): string {
  const count = (o: RunOutcome) => runs.filter((r) => r.outcome === o).length;
  const parts: [number, string][] = [[count('failed'), 'failed'], [count('timed-out'), 'timed out'], [count('stopped'), 'stopped'], [count('no-tests'), 'no tests'], [count('unread'), 'unread']];
  return [String(runs.length), ...parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`)].join(' · ');
}

/** EVID-5.11: an outcome in a word. */
export const OUTCOME_WORD: Record<RunOutcome, string> = {
  passed: 'passed',
  failed: 'failed',
  'timed-out': 'timed out',
  stopped: 'stopped',
  'no-tests': 'no tests',
  running: 'running',
  unread: 'unread',
};
