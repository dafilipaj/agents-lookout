import { spawn } from 'node:child_process';

export interface RunOptions {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  /** Bytes for commands such as git check-ignore --stdin; never interpreted by a shell. */
  stdin?: string;
  /**
   * Cancels the run: the whole process group gets SIGTERM, then SIGKILL. The promise rejects
   * only once the process has exited, so awaiting it means nothing is left behind.
   */
  signal?: AbortSignal;
  /** How long the group gets after SIGTERM before SIGKILL; KILL_GRACE_MS unless a test shortens it. */
  killGraceMs?: number;
  /** How stdout is decoded; `latin1` keeps every byte, for file contents that may not be UTF-8. */
  encoding?: 'utf8' | 'latin1';
}

/** Runs a program with an argv array (never a shell string) and resolves its stdout. */
export type Runner = (file: string, args: readonly string[], opts: RunOptions) => Promise<string>;

export interface RunError extends Error {
  /** `ENOENT` when the program isn't found; the exit code when it failed. */
  code?: string | number | null;
  /** True when the timeout killed the process. */
  timedOut?: boolean;
  stderr?: string;
  /** What it printed on stdout before failing (some tools print a result with a non-zero exit). */
  stdout?: string;
  /** True when the run was cancelled through `signal`. */
  aborted?: boolean;
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
    if (opts.signal?.aborted) {
      reject(Object.assign(new Error(`${file} was cancelled`), { aborted: true, code: null }));
      return;
    }
    const child = spawn(file, [...args], {
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // own process group: `-pid` addresses all of it
    });
    // EPIPE is possible when a refusing command exits before consuming its input. Its exit
    // status remains the authoritative answer, as for commands without stdin.
    child.stdin?.on('error', () => {});
    child.stdin?.end(opts.stdin);
    // Chunks are kept as bytes and decoded once, so a UTF-8 character split across two
    // chunks survives.
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const stdout = () => Buffer.concat(out).toString(opts.encoding ?? 'utf8');
    const stderr = () => Buffer.concat(err).toString('utf8');
    let size = 0;
    let settled = false;
    /** Why the run is being ended early; it is rejected with this once the process has exited. */
    let ending: Partial<RunError> & { message: string } | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    /** SIGTERM to the group, SIGKILL after a grace period; the promise settles on 'close'. */
    const terminate = () => {
      if (killTimer) return;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
        // A process that escaped the group could hold our pipes open; let 'close' happen anyway.
        setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, opts.killGraceMs ?? KILL_GRACE_MS).unref();
      }, opts.killGraceMs ?? KILL_GRACE_MS);
    };
    const endEarly = (reason: Partial<RunError> & { message: string }) => {
      if (ending || settled) return;
      ending = reason;
      clearTimeout(timeout);
      terminate();
    };

    const onAbort = () => {
      endEarly({ message: `${file} was cancelled`, aborted: true, code: null });
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      endEarly({ message: `${file} timed out after ${opts.timeoutMs} ms`, timedOut: true, code: null });
    }, opts.timeoutMs);

    const collect = (which: 'out' | 'err') => (chunk: Buffer) => {
      if (ending) return;
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        endEarly({ message: `${file} printed more than ${MAX_OUTPUT} bytes`, code: null });
        return;
      }
      (which === 'out' ? out : err).push(chunk);
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));

    // The program couldn't start (ENOENT, …): there is no process to wait for.
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (settled || ending) return;
      settled = true;
      clearTimeout(timeout);
      reject(Object.assign(new Error(e.message), { stderr: stderr(), code: e.code ?? null }));
    });
    // Every other outcome, early endings included, settles only once the process has exited,
    // so whoever awaits a run never leaves it behind.
    child.on('close', (code, signal) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (ending) killGroup('SIGKILL'); // nothing it started outlives an early end
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (ending) {
        const { message, ...extra } = ending;
        reject(Object.assign(new Error(message), { stderr: stderr() }, extra));
        return;
      }
      if (code === 0) resolve(stdout());
      else {
        const errText = stderr();
        reject(
          Object.assign(new Error(`${file} exited with ${code ?? signal}${errText ? `: ${errText.trim()}` : ''}`), {
            code,
            stderr: errText,
            stdout: stdout(),
            timedOut: false,
          }),
        );
      }
    });
  });
