import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunError, run } from './exec.ts';

// Made in a hook, not at import: `pnpm req-check` imports this file to collect its titles.
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-exec-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function script(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** PIDs of processes whose command line contains `marker`. */
function pidsWith(marker: string): string[] {
  try {
    return execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

const rejection = (p: Promise<unknown>) => p.then(() => null, (e: RunError) => e);

describe('run', () => {
  it('LIB-2.10: passes file paths to a read-only git question through stdin without shell interpretation', async () => {
    const paths = '/report with spaces.md\n/report$(whoami).html\n';
    expect(await run('/bin/cat', [], { timeoutMs: 2000, stdin: paths })).toBe(paths);
  });

  it('resolves stdout, passing arguments as argv without a shell', async () => {
    expect(await run('/bin/echo', ['$(whoami)', '; ls'], { timeoutMs: 2000 })).toBe('$(whoami) ; ls\n');
  });

  it('decodes UTF-8 once, so a character split across output chunks survives', async () => {
    // é is C3 A9; write the two bytes separately so they arrive in separate chunks.
    const file = script('split', "printf 'caf\\303'; sleep 0.2; printf '\\251\\n'");
    expect(await run(file, [], { timeoutMs: 3000 })).toBe('café\n');
  });

  it('reports a missing program as ENOENT and a failure with its exit code and stderr', async () => {
    expect((await rejection(run(join(dir, 'missing'), [], { timeoutMs: 2000 })))?.code).toBe('ENOENT');
    const err = await rejection(run(script('fails', 'echo oops >&2; exit 3'), [], { timeoutMs: 2000 }));
    expect(err).toMatchObject({ code: 3, stderr: 'oops\n', timedOut: false });
  });

  it('on timeout kills the whole process group, children included', async () => {
    const marker = `lookout-test-child-${process.pid}-a`;
    // A child that keeps running, like a hung `osascript` under fleet.
    const file = script('hangs', `sh -c 'sleep 60; : ${marker}' &\nsleep 60`);
    const err = await rejection(run(file, [], { timeoutMs: 300 }));
    expect(err?.timedOut).toBe(true);
    await expect.poll(() => pidsWith(marker), { timeout: 3000 }).toEqual([]);
  });

  it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
    const marker = `lookout-test-child-${process.pid}-b`;
    const file = script('stubborn', `trap '' TERM\nsh -c 'sleep 60; : ${marker}' &\nsleep 60`);
    const started = Date.now();
    const err = await rejection(run(file, [], { timeoutMs: 300, killGraceMs: 200 }));
    expect(err?.timedOut).toBe(true);
    // The run settles only once the group is gone: after the SIGKILL grace, with nothing left.
    expect(Date.now() - started).toBeGreaterThanOrEqual(300 + 200 - 50);
    expect(pidsWith(marker)).toEqual([]);
  });

  it('a run that printed too much also settles only after its group has exited', async () => {
    const marker = `lookout-test-child-${process.pid}-c`;
    const file = script('chatty', `trap '' TERM\nsh -c 'sleep 60; : ${marker}' &\nhead -c 20000000 /dev/zero\nsleep 60`);
    const err = await rejection(run(file, [], { timeoutMs: 20_000, killGraceMs: 200 }));
    expect(err?.message).toMatch(/printed more than/);
    expect(pidsWith(marker)).toEqual([]);
  });
});
