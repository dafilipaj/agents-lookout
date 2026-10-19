import type { ClaudeUsageDecl, HarnessId, SessionDecl } from '../world/builder.ts';

/**
 * Seams for the next slices of TEST. Nothing here runs yet; the World refuses a declaration that
 * needs it (`NotYetBuilt` in world/builder.ts).
 *
 * TODO(TEST-1.4) Fake Harnesses, `claude.mjs` and `codex.mjs` here:
 *   - started so that `ps` shows argv[0] as `claude` or `codex` (an `exec -a` wrapper in bin/);
 *   - claude: writes `~/.claude/sessions/<pid>.json` with its real `procStart`, appends Claude
 *     Code's JSONL under `~/.claude/projects/<cwd slug>/`, draws a prompt and the permission
 *     layout, honours `--resume <id>` and `/exit`;
 *   - codex: writes `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` with `token_count` events
 *     carrying `rate_limits`, honours `resume <id>`;
 *   - Transcript lines replayed only from recorded fixtures (TEST-6), under e2e/fixtures/.
 * TODO(TEST-1.6) a control file each Fake Harness watches: busy, ask, say, exit, limits.
 * TODO(TEST-1.7) `curl.mjs`: answers only Anthropic's usage endpoint with the declared numbers,
 *   401, 429 or a timeout, checking the fake credentials; any other URL is a violation that fails
 *   the Behaviour test. `tb-jev.mjs`: `status --json` with USAGE's 0.2.0 contract.
 * TODO(TEST-1.10) the `ps` shim in e2e/shims/ps filters machine-wide listings to the World's panes;
 *   only then may a World declare Codex.
 * TODO(TEST-6) e2e/record/: `pnpm e2e:record <claude|codex>`, the only command that runs a real
 *   Harness, writing sanitized fixtures under e2e/fixtures/transcripts/<harness>/<version>/.
 */

/** A fake command the World writes into its `bin/` when declared. */
export interface FakeCommand {
  name: 'claude' | 'codex' | 'tb-jev' | 'curl';
  /** The script, under e2e/fakes/. */
  script: string;
  /** Logged to the World's calls log like Fleet and tb-session (TEST-2.4). */
  logged: true;
}

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

/** Violations a fake recorded; the World fails the Behaviour test on any (TEST-1.7). */
export interface FakeViolation {
  command: FakeCommand['name'];
  argv: string[];
  why: string;
}
