import type { ClaudeUsageDecl, HarnessId, SessionDecl } from '../world/builder.ts';

/**
 * The World's fake commands: claude, codex, tb-jev, curl, tb-prod and tb-pr (TEST-1.2), each on
 * the World's PATH only when declared.
 *
 * Built: WORK's tb-prod/tb-pr, MEM's ps/sysctl, and Fleet usage/tb-jev for populated dock checks.
 * Each is a script node runs from a
 * `bin/` wrapper (e2e/shims/fake) that logs its argv to the World's calls log (TEST-2.4). They read
 * their answer when a call starts, and a test can change it or hold a call in flight (TEST-1.6,
 * control.ts). A call they don't answer is a violation that fails the Behaviour test.
 *
 * The rest are seams for the next slices of TEST. Nothing of them runs yet; the World refuses a
 * declaration that needs them (`NotYetBuilt` in world/builder.ts).
 *
 * TODO(TEST-1.4) Fake Harnesses, `claude` and `codex` here:
 *   - started so that `ps` shows argv[0] as `claude` or `codex` (an `exec -a` wrapper in bin/);
 *   - claude: writes `~/.claude/sessions/<pid>.json` with its real `procStart`, appends Claude
 *     Code's JSONL under `~/.claude/projects/<cwd slug>/`, draws a prompt and the permission
 *     layout, honours `--resume <id>` and `/exit`;
 *   - codex: writes `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` with `token_count` events
 *     carrying `rate_limits`, honours `resume <id>`;
 *   - Transcript lines replayed only from recorded fixtures (TEST-6), under e2e/fixtures/.
 * TODO(TEST-1.6) a control file each Fake Harness watches: busy, ask, say, exit, limits.
 * TODO(TEST-1.7) `curl`: answers only Anthropic's usage endpoint with the declared numbers, 401,
 *   429 or a timeout, checking the fake credentials; any other URL is a violation that fails the
 *   Behaviour test. `tb-jev`: `status --json` with USAGE's 0.2.0 contract.
 * TODO(TEST-1.10) the `ps` shim in e2e/shims/ps filters machine-wide listings to the World's panes;
 *   only then may a World declare Codex.
 * TODO(TEST-6) e2e/record/: `pnpm e2e:record <claude|codex>`, the only command that runs a real
 *   Harness, writing sanitized fixtures under e2e/fixtures/transcripts/<harness>/<version>/.
 */

/** A declared fake command or Fleet usage override, run from e2e/fakes/<name>.ts. */
export type FakeCommand = 'claude' | 'codex' | 'tb-jev' | 'curl' | 'tb-prod' | 'tb-pr' | 'tb-session' | 'ps' | 'sysctl' | 'fleet-usage';

/** What a Fake Harness reads from the World when it starts. */
export interface FakeHarnessConfig {
  harness: HarnessId;
  session: SessionDecl;
  /** The recorded Transcript version it replays (TEST-6). */
  version: string;
  /** The control file a Behaviour test writes to steer it (TEST-1.6). */
  controlFile: string;
}

/** What the fake `curl` answers (TEST-1.7). */
export interface FakeCurlConfig {
  usage: ClaudeUsageDecl;
  /** The bearer token in the World's fake `~/.claude/.credentials.json`. */
  token: string;
  /** Where it records a request it refused, which fails the Behaviour test. */
  violations: string;
}

/** A call a fake refused; the World fails the Behaviour test on any (TEST-1.5, TEST-1.7). */
export interface FakeViolation {
  command: FakeCommand;
  argv: string[];
  why: string;
}
