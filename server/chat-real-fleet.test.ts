import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPin, loadPins } from '../e2e/world/pins.ts';
import type { ChatEvent, SessionRow } from '../shared/types.ts';
import { run } from './exec.ts';
import { fetchFleetList } from './fleet.ts';
import { chatViewer, replay } from './test/helpers.ts';
import { OLD_FLEET_SEND, ViewError, type Viewer } from './viewer.ts';

/**
 * The chat against the real Fleet fork at its pin (`e2e/pins.json`, installed into `.cache/` by
 * `pnpm e2e:setup`), not the fake one. Finding a Session's Transcript is Fleet's job, so only the
 * real binary can show that the chat still finds it. Fleet lists a canned Session
 * (`FLEET_FIXTURE`, the hook its own tests use) and reads a temporary HOME, with nothing on PATH:
 * no process, tmux server or real Transcript is touched.
 */

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000107';
const REPO = '/work/app';
const WORKTREE = '/work/app/.claude/worktrees/fix-export';

let fleet: string;
beforeAll(() => {
  const pin = checkPin(loadPins().fleet);
  if (!pin.ok) throw new Error(pin.problem);
  fleet = pin.bin;
});

let root: string;
let env: NodeJS.ProcessEnv;
let viewer: Viewer | null = null;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lookout-real-fleet-'));
  for (const dir of ['home', 'bin', 'tmp', 'tmux', 'fleet/locks']) mkdirSync(join(root, dir), { recursive: true });
  // Naming, grouping and stacks would run `claude -p`: off, as in a World.
  writeFileSync(join(root, 'fleet', 'config.json'), JSON.stringify({ version: 1, naming: { enabled: false }, grouping: { enabled: false }, stacks: { enabled: false } }));
  // Built from nothing, so none of the runner's variables (CODEX_HOME, TMUX, FLEET_*) leak in.
  env = {
    HOME: join(root, 'home'),
    PATH: join(root, 'bin'),
    TMPDIR: join(root, 'tmp'),
    LANG: 'en_US.UTF-8',
    NO_COLOR: '1',
    FLEET_PATH_ONLY: '1',
    FLEET_FIXTURE: join(root, 'sessions.json'),
    FLEET_CONFIG: join(root, 'fleet', 'config.json'),
    FLEET_SNAPSHOT: join(root, 'fleet', 'snapshot.json'),
    FLEET_LOCK_DIR: join(root, 'fleet', 'locks'),
    FLEET_MUX: '0',
    TMUX_TMPDIR: join(root, 'tmux'),
  };
});
afterEach(() => {
  viewer?.stop();
  viewer = null;
  rmSync(root, { recursive: true, force: true });
});

/** Fleet lists one idle Claude Code Session, running in `cwd`. */
function listed(cwd: string): void {
  const row = { pid: 4242, session_id: SESSION, cwd, status: 'idle', backend: 'tmux', harness: 'claude', transcript: null };
  writeFileSync(env.FLEET_FIXTURE!, JSON.stringify([row]));
}

let n = 0;
const line = (role: 'user' | 'assistant', text: string, cwd: string) => {
  n += 1;
  const base = { type: role, sessionId: SESSION, cwd, uuid: `u-${n}`, timestamp: `2026-10-19T09:00:${String(n % 60).padStart(2, '0')}.000Z` };
  return role === 'user'
    ? { ...base, message: { role, content: text } }
    : { ...base, message: { id: `msg_${n}`, role, content: [{ type: 'text', text }], stop_reason: 'end_turn' } };
};

/** The Transcript, filed under the project directory Claude Code names after `dir`. */
function filedUnder(dir: string, lines: object[]): string {
  const path = join(env.HOME!, '.claude', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  return path;
}

/** Lookout's server views the Session as a tab would: the real `fleet list`, then the chat feed. */
async function view(): Promise<{ row: SessionRow | undefined; events: ChatEvent[] }> {
  const list = await fetchFleetList((file, args, opts) => run(file, args, { ...opts, env }), fleet);
  if (list.kind !== 'ok') throw new Error(`fleet list: ${JSON.stringify(list)}`);
  const chat = chatViewer(fleet, env, list.rows);
  viewer = chat.viewer;
  viewer.watch('tab-1', SESSION, false);
  return { row: chat.rows.get(SESSION), events: chat.events };
}

/** What the tab's chat shows, every entry: a duplicated or lost one shows up here. */
const shown = (events: ChatEvent[]) => replay(events).entries.map((e) => ('text' in e ? e.text : e.kind));

const problems = (events: ChatEvent[]) => events.flatMap((e) => (e.op === 'problem' && e.problem ? [e.problem] : []));

// Every `fleet` call starts the real binary, so the test outlasts its two 5 s waits by a margin;
// a slow run then fails on the wait, with the diff, not on the test's own timeout.
describe('the chat against the real pinned Fleet', { timeout: 15_000 }, () => {
  it('VIEW-1.7: a Claude Code Session that moved into a Worktree shows the Transcript filed under the directory it started in, and keeps following it', async () => {
    listed(WORKTREE);
    const path = filedUnder(REPO, [line('user', 'Export the invoices, in a Worktree', REPO), line('assistant', 'Entered the Worktree fix-export.', WORKTREE)]);

    const { row, events } = await view();
    expect(row?.cwd).toBe(WORKTREE);
    await vi.waitFor(() => expect(shown(events)).toEqual(['Export the invoices, in a Worktree', 'Entered the Worktree fix-export.']), { timeout: 5000 });

    // The Harness goes on writing there: the next poll finds it in the same place.
    appendFileSync(path, `${JSON.stringify(line('assistant', 'Exported 12 invoices.', WORKTREE))}\n`);
    await vi.waitFor(() => expect(shown(events)).toEqual(['Export the invoices, in a Worktree', 'Entered the Worktree fix-export.', 'Exported 12 invoices.']), { timeout: 5000 });
    expect(problems(events)).toEqual([]);
  });

  // A held send needs a terminal Fleet reads the input box from (a Fake Harness, TEST-1.4): a
  // canned Session has none, so Fleet refuses it before any read. What the pinned Fleet can show
  // here is that it takes the flags Lookout's send passes, and that its refusal reaches the tab as
  // its own reason, not as an unknown flag.
  it('VIEW-3.7: the pinned Fleet takes `send --json --require-empty`; a Session it can’t type into is its own refusal, and nothing is typed', async () => {
    listed(REPO);
    filedUnder(REPO, [line('user', 'Hello', REPO)]);
    const { events } = await view();
    await vi.waitFor(() => expect(shown(events)).toEqual(['Hello']), { timeout: 5000 });
    const err = await viewer!.send(SESSION, { text: 'Reply with OK' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ViewError);
    expect(err).toMatchObject({ status: 502, held: null, message: expect.stringMatching(/^Couldn't send: fixture mode/) });
    expect((err as ViewError).message).not.toBe(OLD_FLEET_SEND);
  });

  it.each([
    ['/work/api', REPO],
    [REPO, WORKTREE],
  ])('VIEW-1.7: a Session Fleet lists in %s shows its Transcript filed under %s', async (cwd, dir) => {
    listed(cwd);
    filedUnder(dir, [line('user', 'Where are you?', dir), line('assistant', `In ${cwd}.`, cwd)]);

    const { events } = await view();
    await vi.waitFor(() => expect(shown(events)).toEqual(['Where are you?', `In ${cwd}.`]), { timeout: 5000 });
    expect(problems(events)).toEqual([]);
  });
});
