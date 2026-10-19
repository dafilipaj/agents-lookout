import type { Settings } from '../../shared/settings.ts';

/**
 * TEST-1.5: a World is declared in code, with a builder that starts empty. Every method returns
 * a new builder, so a shared base World can't be changed by one Behaviour test for another.
 *
 * What a World holds by default: the real tools of TEST-1.2 (Fleet and tb-session included), and
 * nothing else: no Harness, no Session, no repo, no History, no usage numbers, Jev absent.
 */

export type HarnessId = 'claude' | 'codex';
/** The real tools a World can take away (SIDE-6.1 runs without Fleet). */
export type RemovableTool = 'fleet' | 'tb-session';

/** Claude Code's usage the fake `curl` answers with (TEST-1.7). */
export interface ClaudeUsageDecl {
  session?: number;
  weekly_all?: number;
  /** An HTTP failure instead of numbers, or a request that never answers. */
  failure?: 401 | 429 | 'timeout';
}

export interface HarnessDecl {
  /** The recorded Transcript version the Fake Harness replays (TEST-6); newest when unset. */
  version?: string;
  usage?: ClaudeUsageDecl | Record<string, unknown>;
}

/** A live Session, started as a Fake Harness in the World's tmux (TEST-1.4). */
export interface SessionDecl {
  harness: HarnessId;
  status?: 'idle' | 'busy' | 'waiting';
  /** Relative to the World's HOME, or absolute. */
  cwd?: string;
  /** A recorded fixture (TEST-6), e.g. `claude/2.1.170/reply`. */
  transcript?: string;
}

export interface RepoDecl {
  name: string;
  worktrees?: string[];
}

/** A past Session for History (HIST), written where tb-session indexes it. */
export interface PastSessionDecl {
  harness: HarnessId;
  transcript: string;
  cwd?: string;
}

export interface WorldSpec {
  /** Real tools removed from PATH (and from `LOOKOUT_*_BIN`). */
  without: RemovableTool[];
  /** Harnesses present, each with its Fake Harness on PATH. Absent unless declared. */
  harnesses: Partial<Record<HarnessId, HarnessDecl>>;
  /** Harnesses declared absent on purpose; reported in the declaration, absent either way. */
  absentHarnesses: HarnessId[];
  sessions: SessionDecl[];
  repos: RepoDecl[];
  history: PastSessionDecl[];
  jev: 'absent' | 'ready' | 'not-set-up';
  settings: Partial<Pick<Settings, 'idleThresholdHours' | 'startDirectories'>>;
}

/** A declaration this slice can't build yet: the World refuses it instead of ignoring it. */
export class NotYetBuilt extends Error {
  constructor(what: string, criterion: string) {
    super(`${what} isn't built yet (${criterion}, docs/features/behaviour-tests/SPEC.md).`);
  }
}

export class WorldBuilder {
  readonly spec: Readonly<WorldSpec>;

  constructor(spec: WorldSpec) {
    this.spec = spec;
  }

  private next(patch: Partial<WorldSpec>): WorldBuilder {
    return new WorldBuilder({ ...this.spec, ...patch });
  }

  /**
   * A Harness present: its Fake Harness on PATH, its home directory, its launcher in the Fleet
   * config, and optionally usage numbers.
   *
   * TODO(TEST-1.4, TEST-1.6, TEST-1.7, TEST-1.10): Fake Harnesses, fake `curl` and the `ps` shim.
   * Codex must not be declared before the `ps` shim exists: Fleet scans every process for
   * `codex`, so the user's own Codex TUIs would show up in the World.
   */
  with(harness: HarnessId, decl: HarnessDecl = {}): WorldBuilder {
    void decl;
    throw new NotYetBuilt(`world().with('${harness}')`, 'TEST-1.4');
  }

  /**
   * Absent on every axis Lookout and Fleet check. For a Harness: no CLI, no home directory, and
   * a launcher in the Fleet config that doesn't exist (`.without('codex')` removes both the CLI
   * and `~/.codex`). For Fleet or tb-session: not on PATH, no `LOOKOUT_*_BIN`.
   */
  without(what: HarnessId | RemovableTool): WorldBuilder {
    if (what === 'claude' || what === 'codex') {
      const { [what]: _removed, ...harnesses } = this.spec.harnesses;
      return this.next({ harnesses, absentHarnesses: unique([...this.spec.absentHarnesses, what]) });
    }
    return this.next({ without: unique([...this.spec.without, what]) });
  }

  /** TODO(TEST-1.4): a live Session as a Fake Harness; the World waits until Fleet lists it. */
  session(decl: SessionDecl): WorldBuilder {
    void decl;
    throw new NotYetBuilt('world().session()', 'TEST-1.4');
  }

  /** TODO(TEST-1.5): a git repo under `~/Projects`, with Worktrees. */
  repo(name: string, opts: Omit<RepoDecl, 'name'> = {}): WorldBuilder {
    void name;
    void opts;
    throw new NotYetBuilt('world().repo()', 'TEST-1.5');
  }

  /** TODO(TEST-1.5, TEST-6): past Sessions from recorded Transcripts, for History. */
  history(sessions: PastSessionDecl[]): WorldBuilder {
    void sessions;
    throw new NotYetBuilt('world().history()', 'TEST-1.5');
  }

  /** TODO(TEST-1.7): the fake `tb-jev`, answering `status --json` with USAGE's 0.2.0 contract. */
  jev(state: 'ready' | 'not-set-up'): WorldBuilder {
    void state;
    throw new NotYetBuilt('world().jev()', 'TEST-1.7');
  }

  /** Lookout's settings file, merged over the defaults. */
  settings(settings: WorldSpec['settings']): WorldBuilder {
    return this.next({ settings: { ...this.spec.settings, ...settings } });
  }

  /** The World's declaration, as it goes into a failure report (TEST-2.4). */
  declaration(): WorldSpec {
    return structuredClone(this.spec) as WorldSpec;
  }
}

/** An empty World (TEST-1.5). Helpers for common Worlds are built on top of it, never instead. */
export function world(): WorldBuilder {
  return new WorldBuilder({
    without: [],
    harnesses: {},
    absentHarnesses: [],
    sessions: [],
    repos: [],
    history: [],
    jev: 'absent',
    settings: {},
  });
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
