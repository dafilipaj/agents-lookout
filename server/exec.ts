import { spawn } from 'node:child_process';

export interface RunOptions {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

/** Runs a program with an argv array (never a shell string) and resolves its stdout. */
export type Runner = (file: string, args: readonly string[], opts: RunOptions) => Promise<string>;

export interface RunError extends Error {
  /** `ENOENT` when the program isn't found; the exit code when it failed. */
  code?: string | number | null;
  /** True when the timeout killed the process. */
  timedOut?: boolean;
  stderr?: string;
}

const MAX_OUTPUT = 16 * 1024 * 1024;
/** How long a timed-out process group gets after SIGTERM before SIGKILL. */
export const KILL_GRACE_MS = 1000;

/**
 * Runs the program in its own process group, so a timeout kills everything it started too
 * (Fleet runs `osascript`, `lsof`, `ps`… which would otherwise be orphaned every poll).
 */
export const run: Runner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group: `-pid` addresses all of it
    });
    // Chunks are kept as bytes and decoded once, so a UTF-8 character split across two
    // chunks survives.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const stdout = () => Buffer.concat(out).toString('utf8');
    const stderr = () => Buffer.concat(err).toString('utf8');
    let size = 0;
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    const terminate = () => {
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };
    const fail = (message: string, extra: Partial<RunError>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(Object.assign(new Error(message), { stderr: stderr() }, extra));
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
      fail(`${file} timed out after ${opts.timeoutMs} ms`, { timedOut: true, code: null });
    }, opts.timeoutMs);

    const collect = (which: 'out' | 'err') => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        terminate();
        fail(`${file} printed more than ${MAX_OUTPUT} bytes`, { code: null });
        return;
      }
      (which === 'out' ? out : err).push(chunk);
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));

    child.on('error', (err: NodeJS.ErrnoException) => fail(err.message, { code: err.code ?? null }));
    child.on('close', (code, signal) => {
      // The leader exited; make sure nothing it started outlives a timeout.
      if (timedOut) killGroup('SIGKILL');
      else if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve(stdout());
      else {
        const errText = stderr();
        reject(
          Object.assign(new Error(`${file} exited with ${code ?? signal}${errText ? `: ${errText.trim()}` : ''}`), {
            code,
            stderr: errText,
            timedOut: false,
          }),
        );
      }
    });
  });
