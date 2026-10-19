import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../shared/types.ts';
import { run } from './exec.ts';
import type { FleetRow } from './fleet.ts';
import { fetchMessages, isCursor } from './messages.ts';
import { chatViewer, replay } from './test/helpers.ts';
import type { Viewer } from './viewer.ts';

/**
 * The chat end to end against the fake `fleet` executable (real processes, real timers): what a
 * Harness does to its Transcript (answering, growing a reply, queueing a prompt, taking it)
 * reaches the tab as Fleet's contract describes.
 */
const FAKE = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;
const CLAUDE = 'aaaaaaaa-0000-4000-8000-000000000101';
const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102';

let dir: string;
let env: NodeJS.ProcessEnv;
let viewer: Viewer | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-chat-fleet-'));
  cpSync(FIXTURES, dir, { recursive: true });
  env = { PATH: process.env.PATH, FAKE_FLEET_DIR: dir };
});
afterEach(() => {
  viewer?.stop();
  viewer = null;
  rmSync(dir, { recursive: true, force: true });
});

const harness = (...args: string[]) => run(FAKE, ['fake', ...args], { timeoutMs: 5000, env });

function start() {
  const chat = chatViewer(FAKE, env, JSON.parse(readFileSync(join(dir, 'list.json'), 'utf8')) as FleetRow[]);
  viewer = chat.viewer;
  return chat;
}

describe('the chat against a fake fleet (end to end)', () => {
  it('VIEW-1.9: answering a pending question flips its card to answered, live, with the picked option', async () => {
    const { viewer, events } = start();
    viewer.watch('tab-1', CLAUDE, false);
    await vi.waitFor(() => expect(events.some((e) => e.op === 'reset')).toBe(true));
    const pending = () => replay(events).entries.filter((e) => e.kind === 'question' && e.status === 'pending');
    expect(pending()).toHaveLength(1);
    await harness('answer', CLAUDE, '1');
    await vi.waitFor(() => expect(pending()).toHaveLength(0));
    const answered = replay(events).entries.at(-1)!;
    expect(answered).toMatchObject({ kind: 'question', status: 'answered', answer: { answers: ['Only push'], picked: [[1]] } });
  });

  it('VIEW-1.1: a reply that keeps streaming grows in place', async () => {
    const { viewer, events } = start();
    viewer.watch('tab-1', CODEX, false);
    await vi.waitFor(() => expect(events.some((e) => e.op === 'reset')).toBe(true));
    const count = replay(events).entries.length;
    await harness('grow', CODEX, ' Also checked page 4.');
    await vi.waitFor(() => expect(replay(events).entries.at(-1)).toMatchObject({ text: expect.stringContaining('Also checked page 4.') }));
    expect(replay(events).entries).toHaveLength(count);
  });

  it('VIEW-3.3: a prompt sent while Busy is queued once; when the Harness takes it, it moves into the history once', async () => {
    const { viewer, events } = start();
    await harness('busy', CODEX, 'on');
    viewer.watch('tab-1', CODEX, false);
    await vi.waitFor(() => expect(events.some((e) => e.op === 'reset')).toBe(true));
    await viewer.send(CODEX, { text: 'Also export the credit notes' });
    await vi.waitFor(() => expect(replay(events).queue.map((q) => q.kind === 'user' && q.text)).toEqual(['Also export the credit notes']));
    await new Promise((r) => setTimeout(r, 300)); // more polls: the queue is repeated, not appended
    const copies = (v: { entries: ChatEntry[] }) => v.entries.filter((e) => e.kind === 'user' && e.text === 'Also export the credit notes');
    expect(copies(replay(events))).toHaveLength(0);
    expect(replay(events).queue).toHaveLength(1);

    await harness('take', CODEX);
    await vi.waitFor(() => expect(replay(events).queue).toEqual([]));
    expect(copies(replay(events))).toHaveLength(1);
    // A queued `q…` cursor was never used to poll or page.
    const log = events.flatMap((e) => (e.op === 'append' || e.op === 'reset' ? e.entries : []));
    expect(log.some((e) => e.cursor.startsWith('q'))).toBe(false);
  });

  it('cursors from Fleet are printable ASCII without a leading dash; queued ones are kept apart', async () => {
    await harness('busy', CODEX, 'on');
    await run(FAKE, ['--local', 'send', '--', CODEX, 'queued one'], { timeoutMs: 5000, env });
    const res = await fetchMessages(run, FAKE, CODEX, { limit: 100 }, { timeoutMs: 5000, env });
    if (!res.ok) throw new Error(res.error);
    expect(res.queue.map((q) => q.cursor)).toEqual(['q1.0']);
    expect(res.entries.every((e) => !e.cursor.startsWith('q'))).toBe(true);
    expect(isCursor(res.cursor!)).toBe(true);
    expect(isCursor('-c1')).toBe(false);
    expect(isCursor('c 1')).toBe(false);
    expect(isCursor('cü')).toBe(false);
  });
});
