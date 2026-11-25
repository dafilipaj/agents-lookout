import type { CommandItem, CommandList } from '@shared/commands.ts';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS_FRESH_MS, ComposerCommands, commandsId, couldntReadEvery, rankCommands } from './commands';

const item = (call: string, over: Partial<CommandItem> = {}): CommandItem => ({ call, name: call.slice(1), hint: null, description: `What ${call} does.`, source: 'builtin', plugin: null, dialog: false, ...over });
const calls = (ranked: readonly { item: CommandItem }[]) => ranked.map((r) => r.item.call);

// Invented look-alikes; no real skill is copied here.
const ITEMS: CommandItem[] = [
  item('/compact'),
  item('/config', { dialog: true }),
  item('/code-review'),
  item('/autocompact', { dialog: true }),
  item('/copy', { dialog: true }),
  item('/notes', { source: 'yours', description: 'Keep notes for the compact log.' }),
  item('/ship-it', { source: 'repo', description: 'Ship the ledger.' }),
  item('/p-kit:code', { source: 'plugin', plugin: 'p-kit', description: 'Write the change.' }),
  item('/a-kit:review', { source: 'plugin', plugin: 'a-kit', description: 'Review a change.' }),
  item('/anthropic-skills:docs', { source: 'claude-ai', description: 'Shared docs.' }),
];

describe('narrowing and ordering a `/` list', () => {
  it('VIEW-15.6: with nothing after the `/`, every item, by source and then by name', () => {
    expect(calls(rankCommands(ITEMS, '/'))).toEqual(['/ship-it', '/notes', '/a-kit:review', '/p-kit:code', '/anthropic-skills:docs', '/autocompact', '/code-review', '/compact', '/config', '/copy']);
  });

  it('VIEW-15.6: the best match first: a name that starts with it, a part that does, a name that holds it, then a description', () => {
    // `/compact`, `/config`, `/copy` and `/code-review` start with "co"; `/p-kit:code`'s part does; `/autocompact` holds it; `/notes`' description does.
    expect(calls(rankCommands(ITEMS, '/co'))).toEqual(['/code-review', '/compact', '/config', '/copy', '/p-kit:code', '/autocompact', '/notes']);
    // "compact" starts one name, sits in another, and is in a description.
    expect(calls(rankCommands(ITEMS, '/compact'))).toEqual(['/compact', '/autocompact', '/notes']);
    // A part follows `:`, `-` or `_`.
    expect(calls(rankCommands(ITEMS, '/review'))).toEqual(['/a-kit:review', '/code-review']);
    expect(calls(rankCommands(ITEMS, '/it'))).toEqual(['/ship-it', '/a-kit:review', '/p-kit:code']);
  });

  it('VIEW-15.6: the item that is the word, whole, comes before every other', () => {
    const items = [item('$review', { source: 'yours' }), item('/review'), item('/review-all', { source: 'repo' })];
    // Codex: `/review` typed is the Built-in command; the skill of that name is `$review`.
    expect(calls(rankCommands(items, '/review'))).toEqual(['/review', '/review-all', '$review']);
  });

  it('VIEW-15.6: from 3 letters a name matches with its letters in order, as the Session filter matches names', () => {
    expect(calls(rankCommands(ITEMS, '/cdrv'))).toEqual(['/code-review']);
    expect(calls(rankCommands(ITEMS, '/shp'))).toEqual(['/ship-it']);
    // Two letters in order aren't enough: only what holds them.
    expect(calls(rankCommands(ITEMS, '/cr'))).toEqual([]);
  });

  it('VIEW-15.6: case is ignored, and what matched is marked in the item as called or in its description', () => {
    expect(rankCommands(ITEMS, '/COMP')[0]).toMatchObject({ item: { call: '/compact' }, call: [[1, 5]], description: [] });
    expect(rankCommands(ITEMS, '/code').find((r) => r.item.call === '/p-kit:code')).toMatchObject({ call: [[7, 11]] });
    expect(rankCommands(ITEMS, '/ledger')).toEqual([{ item: expect.objectContaining({ call: '/ship-it' }), call: [], description: [[9, 15]] }]);
    expect(rankCommands([item('$cx-review', { source: 'yours' })], '/rev')[0]).toMatchObject({ call: [[4, 7]] });
    expect(rankCommands(ITEMS, '/zzz')).toEqual([]);
  });
});

describe('the lists a tab has read', () => {
  const list = (readAt: number, error: string | null = null): CommandList => ({ harness: 'claude', items: [item('/compact')], error, readAt });

  it('LAUNCH-8.1: a list is kept per Session, or per Harness, directory and continued Session', () => {
    expect(commandsId({ session: 'a' })).not.toBe(commandsId({ session: 'b' }));
    const ids = [
      commandsId({ harness: 'claude', directory: '~/Projects/ledger' }),
      commandsId({ harness: 'codex', directory: '~/Projects/ledger' }),
      commandsId({ harness: 'claude', directory: '~/Projects/other' }),
      commandsId({ harness: 'claude', directory: '~/Projects/ledger', continues: { sessionId: 's-9', harness: 'claude' } }),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('VIEW-15.10: opening reads the list, unless it was read in the last 30 s; the earlier list shows meanwhile', async () => {
    let now = 1_000;
    const read = vi.fn(async () => list(now));
    const store = new ComposerCommands(read, () => now);
    const seen = vi.fn();
    store.subscribe(seen);
    const id = commandsId({ session: 'a' });
    expect(store.state(id)).toEqual({ list: null, error: null, reading: false });

    store.open({ session: 'a' });
    expect(store.state(id)).toEqual({ list: null, error: null, reading: true });
    store.open({ session: 'a' }); // a read under way isn't started twice
    await vi.waitFor(() => expect(store.state(id).reading).toBe(false));
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.state(id).list?.readAt).toBe(1_000);
    expect(seen).toHaveBeenCalled();

    now += COMMANDS_FRESH_MS - 1;
    store.open({ session: 'a' });
    expect(read).toHaveBeenCalledTimes(1);

    now += 1;
    store.open({ session: 'a' });
    expect(read).toHaveBeenCalledTimes(2);
    // The earlier list shows while the newer one is read.
    expect(store.state(id)).toMatchObject({ reading: true, list: { readAt: 1_000 } });
    await vi.waitFor(() => expect(store.state(id).reading).toBe(false));
    expect(store.state(id).list?.readAt).toBe(now);

    // Another Session's list is its own.
    store.open({ session: 'b' });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('VIEW-15.10: a read that fails says why and keeps the earlier list; the next opening reads again', async () => {
    let fail = false;
    const read = vi.fn(async () => {
      if (fail) throw new Error("Reading the commands and skills failed: the server didn't answer.");
      return list(1, 'claude plugin list --json: timed out');
    });
    let now = 0;
    const store = new ComposerCommands(read, () => now);
    const id = commandsId({ session: 'a' });
    store.open({ session: 'a' });
    await vi.waitFor(() => expect(store.state(id).reading).toBe(false));
    // A read that couldn't read every skill says so, and why, with what it did read.
    expect(store.state(id)).toMatchObject({ error: "Couldn't read every command and skill: claude plugin list --json: timed out", list: { readAt: 1 } });
    expect(couldntReadEvery('x: not a regular file')).toBe("Couldn't read every command and skill: x: not a regular file");

    fail = true;
    const fresh = new ComposerCommands(read, () => 0);
    fresh.open({ session: 'a' });
    await vi.waitFor(() => expect(fresh.state(id).reading).toBe(false));
    // A read that failed says only its own reason.
    expect(fresh.state(id)).toEqual({ list: null, error: "Reading the commands and skills failed: the server didn't answer.", reading: false });
    fresh.open({ session: 'a' });
    expect(read).toHaveBeenCalledTimes(3);

    // The earlier list stays under a later read that failed.
    now = COMMANDS_FRESH_MS;
    store.open({ session: 'a' });
    expect(read).toHaveBeenCalledTimes(4);
    await vi.waitFor(() => expect(store.state(id).reading).toBe(false));
    expect(store.state(id)).toMatchObject({ error: "Reading the commands and skills failed: the server didn't answer.", list: { readAt: 1 } });
  });
});
