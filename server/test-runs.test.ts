import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CommandRow, exitDecides, isTestFile, namesRunner, onlyReads, READERS, RUNNERS, SUMMARY_LINES, summaries, testRun } from './test-runs.ts';

// Invented commands and output, in the shapes each runner prints (Technical approach, "Lookout's rules").
const VITEST_PASS = ' Test Files  12 passed (12)\n      Tests  180 passed (180)\n   Duration  4.2s\n';
const VITEST_FAIL = ' Test Files  1 failed | 11 passed (12)\n      Tests  2 failed | 2180 passed (2182)\n';
const row = (command: string, extra: Partial<CommandRow> = {}): CommandRow => ({ key: 'toolu_1', command, timestamp: Date.parse('2026-11-18T14:20:00Z'), ended: 'exited', exitCode: 0, outputTail: null, subagent: false, ...extra });

describe('EVID-2.1: a Test run', () => {
  it('EVID-2.1: is found by a summary line in its output, or by its command naming a runner once wrappers are stripped', () => {
    expect(testRun(row('make check', { outputTail: VITEST_PASS }))).toMatchObject({ outcome: 'passed', passed: 180, failed: 0 });
    for (const command of [
      'pnpm test',
      'npm run test:unit',
      'yarn e2e --project chromium',
      'bun test',
      'pnpm exec vitest run',
      'pnpm -s vitest',
      'pnpm --filter web test',
      'env -u NODE_ENV pnpm -s vitest',
      'CI=1 FORCE_COLOR=0 npx jest src',
      'timeout 600 cargo test -p shop',
      'cargo +nightly nextest run',
      'time python -m pytest tests/',
      'res run --prio check -- pnpm exec vitest run',
      'npx playwright test e2e/login.spec.ts',
      "sh -c 'cd web && pnpm vitest run'",
      'for f in a b; do pnpm vitest run "$f"; done',
      'pytest>/tmp/pytest.log',
      'pnpm test>>/tmp/out.log 2>&1',
      "env -S 'pnpm test'",
      "env -S 'CI=1 pnpm vitest run'",
    ]) expect(namesRunner(command), command).toBe(true);
    for (const command of ['git commit -m "pnpm test"', 'echo pnpm test', 'grep -rn vitest src', 'pnpm install', 'pnpm build', 'cargo build', 'playwright install', 'ls tests/']) {
      expect(namesRunner(command), command).toBe(false);
    }
    expect(testRun(row('pnpm build', { outputTail: 'built in 2s' }))).toBeNull();
  });

  it('EVID-2.1: a command a hook or a permission refused is never one', () => {
    expect(testRun(row('pnpm test', { ended: 'refused', exitCode: null, outputTail: 'PreToolUse:Bash hook error: use res' }))).toBeNull();
  });

  it('EVID-2.1: a Subagent’s run is marked as its own', () => {
    expect(testRun(row('pnpm test', { subagent: true, outputTail: VITEST_PASS }))).toMatchObject({ subagent: true, outcome: 'passed' });
  });
});

it('EVID-2.2: a command whose every part only reads files is never a Test run, even with a summary line in its output', () => {
  for (const command of [
    'cat /tmp/out.log',
    'tail -50 /tmp/out.log',
    'tail -n 40 /tmp/out.log | grep -E "FAIL|Tests"',
    'grep -E "Tests|FAIL" /tmp/run.txt',
    "sed -n '1,40p' /tmp/run.txt",
    'cd /tmp && tail -20 out.log',
    'sleep 30; cat /tmp/out.log',
    "sh -c 'tail -40 /tmp/out.log'",
    "bash -lc 'cd /tmp && grep -E \"Tests|FAIL\" out.log'",
    "sh -c 'tail -40 /tmp/out.log' | tail -5",
    "cat /tmp/out.log | sh -c 'grep -E Tests'",
  ]) {
    expect(onlyReads(command), command).toBe(true);
    expect(testRun(row(command, { outputTail: VITEST_FAIL })), command).toBeNull();
  }
  // Reading stdin, or running anything else, isn't only reading a file.
  for (const command of ['pnpm test 2>&1 | tail -5', 'tail -5', 'sed -i s/a/b/ f.txt', 'cat out.log; pnpm test', 'grep FAIL', "sh -c 'pnpm test | tail -5'"]) expect(onlyReads(command), command).toBe(false);
});

describe('EVID-2.3: how a Test run ends', () => {
  it('EVID-2.3: a failed summary line wins over everything, an exit code of 0 included', () => {
    expect(testRun(row('pnpm test 2>&1 | tail -5', { outputTail: VITEST_FAIL, exitCode: 0 }))).toMatchObject({ outcome: 'failed', passed: 2180, failed: 2 });
    expect(testRun(row('pnpm test', { outputTail: VITEST_FAIL, ended: 'running', exitCode: null }))).toMatchObject({ outcome: 'failed' });
  });

  it('EVID-2.3: running, timed out and interrupted come before a passing summary', () => {
    expect(testRun(row('pnpm test', { ended: 'running', exitCode: null, outputTail: VITEST_PASS }))?.outcome).toBe('running');
    expect(testRun(row('pnpm test', { ended: 'timed_out', exitCode: 143, outputTail: VITEST_PASS }))?.outcome).toBe('timed-out');
    expect(testRun(row('pnpm test', { ended: 'interrupted', exitCode: null, outputTail: VITEST_PASS }))?.outcome).toBe('stopped');
  });

  it('EVID-2.3: then passed, then no tests, then the exit code, else unknown; counts are summed over summary lines', () => {
    const twoPackages = '      Tests  4 passed (4)\n      Tests  1 skipped (1)\n';
    expect(testRun(row('pnpm -r test', { outputTail: twoPackages }))).toMatchObject({ outcome: 'passed', passed: 4, failed: 0 });
    expect(testRun(row('pnpm test', { outputTail: 'No test files found, exiting with code 1\n', exitCode: 1 }))).toMatchObject({ outcome: 'no-tests', passed: 0, failed: 0 });
    expect(testRun(row('pnpm test', { outputTail: 'ok', exitCode: 1 }))).toMatchObject({ outcome: 'failed', passed: null, failed: null });
    expect(testRun(row('pnpm test 2>&1 | grep FAIL', { outputTail: '', exitCode: 1 }))).toMatchObject({ outcome: 'unread', passed: null });
  });

  it('EVID-2.3: each runner’s summary lines, and a line of skipped tests only, which ran none', () => {
    const cases: [string, { passed: number; failed: number; none: boolean }][] = [
      ['      Tests  2 failed | 2180 passed (2182)', { passed: 2180, failed: 2, none: false }],
      ['      Tests  3 skipped (3)', { passed: 0, failed: 0, none: true }],
      ['Tests:       1 failed, 5 passed, 6 total', { passed: 5, failed: 1, none: false }],
      ['Tests:       2 skipped, 2 total', { passed: 0, failed: 0, none: true }],
      ['  3 passed (12.1s)', { passed: 3, failed: 0, none: false }],
      ['  1 failed', { passed: 0, failed: 1, none: false }],
      ['  2 flaky', { passed: 2, failed: 0, none: false }],
      ['  3 passed (1.1m)', { passed: 3, failed: 0, none: false }],
      ['=== 12 passed in 65.02s (0:01:05) ===', { passed: 12, failed: 0, none: false }],
      ['test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s', { passed: 4, failed: 0, none: false }],
      ['test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out', { passed: 3, failed: 1, none: false }],
      ['test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out', { passed: 0, failed: 0, none: true }],
      ['=========== 1 failed, 10 passed, 2 warnings in 1.20s ===========', { passed: 10, failed: 1, none: false }],
      ['10 passed in 0.52s', { passed: 10, failed: 0, none: false }],
      ['==== 1 error in 0.30s ====', { passed: 0, failed: 1, none: false }],
      ['============ no tests ran in 0.01s ============', { passed: 0, failed: 0, none: true }],
      ['No test files found, exiting with code 1', { passed: 0, failed: 0, none: true }],
      ['Error: No tests found', { passed: 0, failed: 0, none: true }],
    ];
    for (const [line, expected] of cases) expect(summaries(line), line).toEqual([expected]);
    // Colour codes are stripped; a Vitest "Test Files" line isn't a Tests line.
    expect(summaries('\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m7 passed\u001b[39m\u001b[22m (7)')).toEqual([{ passed: 7, failed: 0, none: false }]);
    expect(summaries(' Test Files  1 failed | 11 passed (12)')).toEqual([]);
  });
});

describe('EVID-2.4: when the exit code decides', () => {
  it('EVID-2.4: only for a last part that runs the runner and pipes into nothing, or with pipefail', () => {
    expect(exitDecides('pnpm test')).toBe(true);
    expect(exitDecides('cd web && pnpm test')).toBe(true);
    expect(exitDecides('pnpm test > /tmp/out.log 2>&1')).toBe(true);
    expect(exitDecides('pnpm test 2>&1 | tail -5')).toBe(false);
    expect(exitDecides('set -o pipefail; pnpm test 2>&1 | tail -5')).toBe(true);
    expect(exitDecides('pnpm test >/dev/null; true')).toBe(false);
    expect(exitDecides('pnpm test && echo ok')).toBe(false);
    expect(exitDecides('pnpm test\necho done')).toBe(false);
    expect(exitDecides('pytest>/tmp/pytest.log')).toBe(true);
    expect(exitDecides('pnpm test >> /tmp/out.log')).toBe(true);
  });

  it('EVID-2.4: pipefail counts only while it’s on, and a negated runner never decides', () => {
    expect(exitDecides('set -eo pipefail; pnpm test | tail -5')).toBe(true);
    expect(exitDecides('set -o errexit -o pipefail; pnpm test | tail -5')).toBe(true);
    expect(exitDecides('set +o pipefail; pnpm test | tail -5')).toBe(false);
    expect(exitDecides('set -o pipefail; set +o pipefail; pnpm test | tail -5')).toBe(false);
    expect(exitDecides('! pnpm test >/dev/null')).toBe(false);
    expect(exitDecides('time ! pnpm test >/dev/null')).toBe(false);
    expect(exitDecides('( ! pnpm test >/dev/null )')).toBe(false);
    expect(exitDecides("env -S 'pnpm test'")).toBe(true);
    expect(testRun(row("env -S 'pnpm test'", { exitCode: 1 }))?.outcome).toBe('failed');
    expect(testRun(row('! pnpm test >/dev/null', { exitCode: 0 }))?.outcome).toBe('unread');
  });

  it('EVID-2.4: a runner inside sh -c is judged by the same rule on the quoted command', () => {
    expect(exitDecides("sh -c 'cd web && pnpm vitest run'")).toBe(true);
    expect(exitDecides("bash -lc 'pnpm test | tail -3'")).toBe(false);
    expect(exitDecides("bash -c 'set -euo pipefail; pnpm test | tail -3'")).toBe(true);
  });

  it('EVID-2.4: 0 is passed, anything else failed; an errored row or a null exit code ends unknown', () => {
    expect(testRun(row('pnpm test >/dev/null; true', { exitCode: 0 }))?.outcome).toBe('unread');
    expect(testRun(row('pnpm test', { exitCode: 0 }))?.outcome).toBe('passed');
    expect(testRun(row('pnpm test', { exitCode: 2 }))?.outcome).toBe('failed');
    expect(testRun(row('pnpm test', { ended: 'errored', exitCode: null }))?.outcome).toBe('unread');
    expect(testRun(row('pnpm test', { ended: 'exited', exitCode: null }))?.outcome).toBe('unread');
  });
});

it('EVID-2.5: a Test run ends at its row’s timestamp', () => {
  const at = Date.parse('2026-11-18T14:26:00Z');
  expect(testRun(row('pnpm test', { timestamp: at }))?.end).toBe(at);
});

it('EVID-2.6: the runners, their summary lines, the wrappers and the readers are constants in one file, not settings', () => {
  expect(RUNNERS.map((r) => r.name)).toEqual(['Vitest', 'Jest', 'Playwright', 'cargo', 'pytest', 'a package script']);
  expect(new Set(SUMMARY_LINES.map((s) => s.runner))).toEqual(new Set(['Vitest', 'Jest', 'Playwright', 'cargo', 'pytest', 'Jest or Playwright']));
  expect(Object.keys(READERS)).toEqual(['cat', 'tail', 'head', 'less', 'grep', 'sed']);
  const settings = readFileSync(new URL('../shared/settings.ts', import.meta.url), 'utf8');
  expect(settings).not.toMatch(/vitest|pytest|runner/i);
});

it('EVID-4.1: a test file by its name or folder, in any language', () => {
  for (const path of ['src/round.test.ts', 'app/models/rate.spec.rb', 'tests/test_round.py', 'pkg/__tests__/a.js', 'e2e/login.ts', 'spec/fixtures/rates.json', 'src/mocks/api.ts']) expect(isTestFile(path), path).toBe(true);
  for (const path of ['src/round.ts', 'testsuite/a.ts', 'src/contest.ts', 'docs/e2e.md']) expect(isTestFile(path), path).toBe(false);
});
