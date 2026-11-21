import type { RunOutcome } from '../shared/evidence.ts';

/**
 * EVID-2: which commands run tests and how each ended. Lookout's rules, not tb-session's (contract
 * K8, decision 0010). EVID-2.6: the runners, their summary lines, the wrappers and the commands that
 * only read files are the constants at the top of this file, not settings.
 */

/** EVID-2.6: a runner's name as its command starts, after wrappers (Technical approach, "Lookout's rules"). */
export const RUNNERS: readonly { name: string; matches(argv: readonly string[]): boolean }[] = [
  { name: 'Vitest', matches: (a) => bin(a[0]) === 'vitest' },
  { name: 'Jest', matches: (a) => bin(a[0]) === 'jest' },
  { name: 'Playwright', matches: (a) => bin(a[0]) === 'playwright' && a[1] === 'test' },
  { name: 'cargo', matches: (a) => bin(a[0]) === 'cargo' && ['test', 'nextest'].includes(a.find((w, i) => i > 0 && !w.startsWith('+')) ?? '') },
  { name: 'pytest', matches: (a) => bin(a[0]) === 'pytest' || (/^python3?$/.test(bin(a[0])) && a[1] === '-m' && a[2] === 'pytest') },
  // A package script: `pnpm`, `npm`, `yarn` or `bun` with `test…` or `e2e…`, `run` optional.
  { name: 'a package script', matches: (a) => PACKAGE_MANAGERS.includes(bin(a[0])) && /^(test|e2e)/.test((a[1] === 'run' || a[1] === 'run-script' ? a[2] : a[1]) ?? '') },
];
const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'];
/** A runner a package manager may run as a bin, as `pnpm vitest run` does. */
const RUNNER_BINS = ['vitest', 'jest', 'playwright', 'pytest'];

/** EVID-2.6: the commands that only read files (EVID-2.2), and how many of their positional words come before a file. */
export const READERS: Readonly<Record<string, { before: number; values: readonly string[] }>> = {
  cat: { before: 0, values: [] },
  tail: { before: 0, values: ['-n', '-c'] },
  head: { before: 0, values: ['-n', '-c'] },
  less: { before: 0, values: [] },
  grep: { before: 1, values: ['-A', '-B', '-C', '-m', '-e', '-f', '--max-count', '--context', '--after-context', '--before-context'] },
  // Only `sed -n`.
  sed: { before: 1, values: ['-e', '-f'] },
};
/** Parts that neither run nor read anything, so a log read after them is still only a read. */
const NEUTRAL = ['cd', 'sleep'];
/** Shell words that start a part without being its command: `do pnpm test` in a loop. */
const KEYWORDS = ['do', 'then', 'else', '!', '{', '(', 'time', 'command', 'exec'];
/** A wrapper that runs its quoted command: `sh -c '…'`, `bash -lc '…'`. */
const SHELLS = ['sh', 'bash', 'zsh'];

const bin = (w: string | undefined) => (w ?? '').split('/').at(-1) ?? '';
/** EVID-5.11: a command is shown whole in its tooltip; past this it's cut, which no test command reaches. */
export const COMMAND_MAX = 20_000;

/** EVID-2.6: a summary line, what it says, and the runner whose line it is. */
interface Summary {
  passed: number;
  failed: number;
  /** A line that says no test ran (or only skipped ones). */
  none: boolean;
}

// eslint-disable-next-line no-control-regex -- ANSI colour codes are what's being stripped
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

/** EVID-2.6: each runner's summary lines; each line counts once, by the first pattern it matches. */
export const SUMMARY_LINES: readonly { runner: string; read(line: string): Summary | null }[] = [
  // Vitest: `      Tests  2 failed | 2180 passed (2182)`; `Test Files` is a different line.
  {
    runner: 'Vitest',
    read: (line) => {
      const m = /^\s*Tests\s{2,}(\d+ [a-z]+(?:\s*\|\s*\d+ [a-z]+)*)\s*\(\d+\)\s*$/.exec(line);
      return m ? counts(m[1]!.split('|')) : null;
    },
  },
  // Jest: `Tests:       1 failed, 5 passed, 6 total`
  {
    runner: 'Jest',
    read: (line) => {
      const m = /^\s*Tests:\s+((?:\d+ [a-z]+,\s*)*)\d+ total\s*$/.exec(line);
      return m ? counts(m[1]!.split(',')) : null;
    },
  },
  // cargo: `test result: ok. 4 passed; 0 failed; 0 ignored; …`; a line of 0 and 0 ran none.
  {
    runner: 'cargo',
    read: (line) => {
      const m = /^\s*test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed;/.exec(line);
      if (!m) return null;
      const passed = Number(m[1]), failed = Number(m[2]);
      return { passed, failed, none: passed === 0 && failed === 0 };
    },
  },
  // pytest: `=== 1 failed, 10 passed in 1.20s ===`, `-q`'s `10 passed in 0.52s`, and `no tests ran in 0.01s`.
  {
    runner: 'pytest',
    read: (line) => {
      if (/^=*\s*no tests ran in [\d.]+(?:ms|s|m|h)\b.*$/.test(line.trim())) return { passed: 0, failed: 0, none: true };
      const m = /^=*\s*((?:\d+ [a-z]+(?:, )?)+) in [\d.]+(?:ms|s|m|h)(?: \([^)]*\))?\s*=*$/.exec(line.trim());
      if (!m || !/\d+ (passed|failed|errors?|skipped)\b/.test(m[1]!)) return null;
      return counts(m[1]!.split(','));
    },
  },
  // Playwright: `  3 passed (12.1s)`, `  1 failed`, `  2 flaky`, indented, alone on their line.
  {
    runner: 'Playwright',
    read: (line) => {
      const m = /^\s+(\d+) (passed|failed|flaky|skipped)(?: \([\d.]+(?:ms|s|m|h)\))?\s*$/.exec(line);
      if (!m) return null;
      return counts([`${m[1]} ${m[2] === 'flaky' ? 'passed' : m[2]}`]);
    },
  },
  // When none ran: Vitest's, Jest's and Playwright's own line, and pytest's above.
  { runner: 'Vitest', read: (line) => (/\bNo test files found\b/.test(line) ? { passed: 0, failed: 0, none: true } : null) },
  { runner: 'Jest or Playwright', read: (line) => (/\bNo tests found\b/.test(line) ? { passed: 0, failed: 0, none: true } : null) },
];

/** `2 failed`, ` 2180 passed`: failed (errors too), passed, and a line of skipped tests only is one that ran none. */
function counts(parts: readonly string[]): Summary {
  let passed = 0, failed = 0;
  for (const p of parts) {
    const m = /(\d+) ([a-z]+)/.exec(p.trim());
    if (!m) continue;
    if (m[2] === 'passed') passed += Number(m[1]);
    else if (m[2] === 'failed' || m[2] === 'error' || m[2] === 'errors') failed += Number(m[1]);
  }
  return { passed, failed, none: passed === 0 && failed === 0 };
}

/** EVID-2.6: the summary lines in an output's tail, anywhere in it. */
export function summaries(tail: string | null): Summary[] {
  if (!tail) return [];
  const out: Summary[] = [];
  for (const raw of tail.replace(ANSI, '').split(/\r?\n|\r/)) {
    for (const s of SUMMARY_LINES) {
      const found = s.read(raw);
      if (found) {
        out.push(found);
        break;
      }
    }
  }
  return out;
}

/** A command split at `&&`, `||`, `;`, `&` and new lines into parts, each a pipeline of words. */
interface Part {
  /** Each command of the pipeline, its words unquoted, redirections left out. */
  pipeline: string[][];
}

/**
 * Splits a command as a shell would at its top level: quotes, escapes and `$(…)` keep their
 * separators. Not a shell parser: what it can't place stays a word.
 */
export function split(command: string): Part[] {
  const parts: Part[] = [];
  let pipeline: string[][] = [];
  let words: string[] = [];
  let word = '';
  let has = false;
  let depth = 0;
  const endWord = () => {
    if (has) words.push(word);
    word = '';
    has = false;
  };
  const endCommand = () => {
    endWord();
    pipeline.push(dropRedirections(words));
    words = [];
  };
  const endPart = () => {
    endCommand();
    const kept = pipeline.filter((c) => c.length);
    if (kept.length) parts.push({ pipeline: kept });
    pipeline = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (depth > 0) {
      word += c;
      if (c === '(') depth++;
      else if (c === ')') depth--;
      continue;
    }
    if (c === '\\' && i + 1 < command.length) {
      if (command[i + 1] === '\n') { i++; continue; }
      word += command[++i];
      has = true;
      continue;
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      word += command.slice(i + 1, end < 0 ? undefined : end);
      has = true;
      i = end < 0 ? command.length : end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === '\\' && j + 1 < command.length) j++;
        word += command[j];
      }
      has = true;
      i = j;
      continue;
    }
    if (c === '$' && command[i + 1] === '(') {
      word += '$(';
      has = true;
      depth = 1;
      i++;
      continue;
    }
    if (c === '#' && !has && (i === 0 || /\s/.test(command[i - 1]!))) {
      const nl = command.indexOf('\n', i);
      i = nl < 0 ? command.length : nl - 1;
      continue;
    }
    if (c === '\n' || c === ';') { endPart(); continue; }
    if (c === '&' && command[i + 1] === '&') { endPart(); i++; continue; }
    if (c === '|' && command[i + 1] === '|') { endPart(); i++; continue; }
    if (c === '|') { endCommand(); if (command[i + 1] === '&') i++; continue; }
    if (c === '&' && command[i + 1] !== '>' && command[i - 1] !== '>' && command[i - 1] !== '<') { endPart(); continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    // A redirection starts a word of its own (`pytest>/tmp/log`), its fd prefix (`2>`, `&>`) kept with it.
    if ((c === '>' || c === '<') && has && !/^(\d+|&)?[<>&]*$/.test(word)) endWord();
    word += c;
    has = true;
  }
  endPart();
  return parts;
}

/** `2>&1`, `>/dev/null`, `> out.log`, `<in`, `&>log`: not words of the command. */
function dropRedirections(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const op = /^(\d*|&)(>>?|<|>&|<&)(.*)$/.exec(w);
    if (op) {
      if (op[3] === '') i++; // its target is the next word
      continue;
    }
    out.push(w);
  }
  return out;
}

/**
 * EVID-2.6: a command's words without its wrappers: `res run … --`, `env` with its flags and
 * assignments, `VAR=value`, `timeout N`, `time`, `npx`, `bunx`, `pnpm exec`, `pnpm -s`,
 * `pnpm --filter X`, a shell word such as `do`; and `pnpm`, `yarn` or `bun` before a runner's name.
 * `sh -c '…'` is returned as `['sh', '-c', '<command>']` for the caller to read.
 */
export function unwrap(argv: readonly string[]): string[] {
  let a = [...argv];
  for (let guard = 0; guard < 20 && a.length; guard++) {
    const head = bin(a[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0]!)) { a = a.slice(1); continue; }
    if (KEYWORDS.includes(a[0]!)) { a = a.slice(1); if (head === 'time') a = a[0] === '-p' ? a.slice(1) : a; continue; }
    if (head === 'env') {
      let i = 1;
      while (i < a.length) {
        const w = a[i]!;
        // `-S 'pnpm test'`: its value is the command, split at spaces.
        if (w === '-S' || w === '--split-string') {
          a = [...(a[i + 1] ?? '').split(/\s+/).filter(Boolean), ...a.slice(i + 2)];
          i = 0;
          break;
        }
        if (w === '-u' || w === '--unset' || w === '-C' || w === '--chdir') i += 2;
        else if (w.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i++;
        else break;
      }
      a = a.slice(i);
      continue;
    }
    if (head === 'timeout') {
      let i = 1;
      while (i < a.length && a[i]!.startsWith('-')) i += a[i] === '-k' || a[i] === '-s' || a[i] === '--signal' || a[i] === '--kill-after' ? 2 : 1;
      a = a.slice(i + 1); // the duration
      continue;
    }
    if (head === 'res' && a[1] === 'run') {
      const dash = a.indexOf('--');
      a = dash < 0 ? a.slice(2) : a.slice(dash + 1);
      continue;
    }
    if (head === 'npx' || head === 'bunx') {
      let i = 1;
      while (i < a.length && a[i]!.startsWith('-')) i += a[i] === '-p' || a[i] === '--package' ? 2 : 1;
      a = a.slice(i);
      continue;
    }
    if (head === 'pnpm' || head === 'yarn' || head === 'bun') {
      let i = 1;
      while (i < a.length && a[i]!.startsWith('-')) i += a[i] === '--filter' || a[i] === '-F' || a[i] === '-C' || a[i] === '--dir' ? 2 : 1;
      const next = a[i];
      if (next === 'exec' || next === 'dlx' || (next !== undefined && RUNNER_BINS.includes(bin(next)))) {
        a = a.slice(next === 'exec' || next === 'dlx' ? i + 1 : i);
        continue;
      }
      if (i > 1) a = [a[0]!, ...a.slice(i)];
      return a;
    }
    return a;
  }
  return a;
}

/** `sh -c '…'`, `bash -lc '…'`: the quoted command; null for anything else. */
function shellC(argv: readonly string[]): string | null {
  if (!SHELLS.includes(bin(argv[0]))) return null;
  const flag = argv.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w));
  return flag > 0 && argv[flag + 1] !== undefined ? argv[flag + 1]! : null;
}

/** EVID-2.1: the command names a test runner, once its wrappers are stripped, in any part, `sh -c` included. */
export function namesRunner(command: string, depth = 0): boolean {
  return split(command).some((p) =>
    p.pipeline.some((argv) => {
      const core = unwrap(argv);
      const inner = shellC(core);
      if (inner !== null) return depth < 3 && namesRunner(inner, depth + 1);
      return RUNNERS.some((r) => r.matches(core));
    }),
  );
}

/** EVID-2.2: every part only reads files (`cd` and `sleep` aside), and at least one does. */
export function onlyReads(command: string, depth = 0, fromFile = true): boolean {
  let reads = false;
  for (const p of split(command)) {
    const members = p.pipeline.map((argv) => unwrap(argv));
    const first = members[0]!;
    if (members.length === 1 && NEUTRAL.includes(bin(first[0]))) continue;
    // `sh -c 'tail -40 /tmp/out.log'` reads as its quoted command does, piped on or not; after a pipe it may read stdin.
    const wrapped = (core: string[], file: boolean) => {
      const inner = shellC(core);
      return inner !== null && depth < 3 && onlyReads(inner, depth + 1, file);
    };
    if (!members.every((core, i) => reader(core) || wrapped(core, i === 0 && fromFile))) return false;
    // What's read comes from a file: the first command names one, or is a wrapped read of one.
    if (fromFile && !wrapped(first, true) && !hasFile(first)) return false;
    reads = true;
  }
  return reads;
}

function reader(argv: readonly string[]): boolean {
  const name = bin(argv[0]);
  if (!(name in READERS)) return false;
  return name !== 'sed' || argv.includes('-n') || argv.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w) && !w.startsWith('--'));
}

/** A reader with a file argument: positional words past its pattern or script. */
function hasFile(argv: readonly string[]): boolean {
  const name = bin(argv[0]);
  const rule = READERS[name];
  if (!rule) return false;
  const positional: string[] = [];
  let pattern = false;
  for (let i = 1; i < argv.length; i++) {
    const w = argv[i]!;
    if (w === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (w.startsWith('-') && w.length > 1) {
      if (rule.values.includes(w)) {
        if (w === '-e' || w === '-f') pattern = true;
        i++;
      }
      continue;
    }
    positional.push(w);
  }
  return positional.length > (pattern ? 0 : rule.before);
}

/** EVID-2.4: the exit code decides: the last part runs a runner and pipes into nothing, or `pipefail` is set. */
export function exitDecides(command: string, depth = 0): boolean {
  const parts = split(command);
  const last = parts.at(-1);
  if (!last) return false;
  // `set -o pipefail` (or `-eo`, `-euo`) turns it on, `set +o pipefail` off, in the order they run.
  let pipefail = false;
  for (const p of parts.slice(0, -1)) {
    for (const argv of p.pipeline) {
      if (bin(argv[0]) !== 'set') continue;
      for (let i = 1; i < argv.length; i++) {
        if (argv[i + 1] === 'pipefail' && /^[-+][a-zA-Z]*o$/.test(argv[i]!)) pipefail = argv[i]!.startsWith('-');
      }
    }
  }
  // `! pnpm test`, `time ! pnpm test`, `( ! pnpm test )`: the exit code is the runner's, inverted.
  if (last.pipeline.some((argv) => argv.includes('!'))) return false;
  const core = unwrap(last.pipeline[0]!);
  if (last.pipeline.length > 1 && !pipefail) return false;
  const inner = shellC(core);
  if (inner !== null) return depth < 3 && exitDecides(inner, depth + 1);
  return RUNNERS.some((r) => r.matches(core));
}

/** What tb-session answers for one command (contract K2), as Lookout reads it. */
export interface CommandRow {
  key: string;
  command: string;
  timestamp: number;
  ended: 'exited' | 'refused' | 'errored' | 'timed_out' | 'interrupted' | 'running';
  exitCode: number | null;
  outputTail: string | null;
  subagent: boolean;
}

/** EVID-2: a Test run, or null for a command that isn't one. */
export interface TestRun {
  key: string;
  end: number;
  outcome: RunOutcome;
  passed: number | null;
  failed: number | null;
  command: string;
  subagent: boolean;
}

/** EVID-2.1 to EVID-2.5: whether a command row is a Test run, and how it ended. */
export function testRun(row: CommandRow): TestRun | null {
  if (row.ended === 'refused') return null;
  if (onlyReads(row.command)) return null;
  const lines = summaries(row.outputTail);
  if (!lines.length && !namesRunner(row.command)) return null;
  const passed = lines.reduce((n, s) => n + s.passed, 0);
  const failed = lines.reduce((n, s) => n + s.failed, 0);
  const counted = lines.length ? { passed, failed } : { passed: null, failed: null };
  return { key: row.key, end: row.timestamp, outcome: outcome(row, lines, passed, failed), ...counted, command: row.command.slice(0, COMMAND_MAX), subagent: row.subagent };
}

/** EVID-2.3: the first that holds. */
function outcome(row: CommandRow, lines: readonly Summary[], passed: number, failed: number): RunOutcome {
  if (failed > 0) return 'failed';
  if (row.ended === 'running') return 'running';
  if (row.ended === 'timed_out') return 'timed-out';
  if (row.ended === 'interrupted') return 'stopped';
  if (passed > 0) return 'passed';
  if (lines.some((s) => s.none)) return 'no-tests';
  // EVID-2.4: an `errored` row, or a null exit code, ends unknown.
  if (row.ended === 'exited' && Number.isInteger(row.exitCode) && exitDecides(row.command)) return row.exitCode === 0 ? 'passed' : 'failed';
  return 'unread';
}

/** EVID-4.1: a test file, by its path (a renamed or deleted file's old path too), in any language. */
export function isTestFile(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  return /\.(test|spec)\./.test(name) || parts.slice(0, -1).some((d) => ['tests', '__tests__', 'e2e', 'fixtures', 'mocks'].includes(d));
}
