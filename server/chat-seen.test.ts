import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_SEEN_TTL_MS, ChatSeen, ChatSeenError } from './chat-seen.ts';

const dirs: string[] = [];
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-chat-seen-'));
  dirs.push(dir);
  return join(dir, 'nested', 'chat-seen.json');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ID = 'bbe95a4c-1462-4eaa-8e31-d91f02dee069';

describe('chat seen', () => {
  it('VIEW-13.1: keeps the last entry seen per Session in a 0600 file, written whole, and reads it back after a restart', async () => {
    const f = file();
    const seen = new ChatSeen({ file: f });
    expect(await seen.get(ID)).toBeNull();
    await seen.set(ID, 'c42', 1_793_880_000_000);
    await seen.set('codex:4242', 'c7', null);
    expect(await seen.get(ID)).toEqual({ cursor: 'c42', at: 1_793_880_000_000 });
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(f, 'utf8')).sessions[ID]).toMatchObject({ cursor: 'c42', at: 1_793_880_000_000 });
    const again = new ChatSeen({ file: f });
    expect(await again.get('codex:4242')).toEqual({ cursor: 'c7', at: null });
  });

  it('VIEW-13.1: a record not used for 30 days goes; reading one counts as using it', async () => {
    const f = file();
    let now = 1_000_000;
    const seen = new ChatSeen({ file: f, now: () => now });
    await seen.set(ID, 'c1', null);
    await seen.set('other', 'c2', null);
    now += CHAT_SEEN_TTL_MS - 10;
    expect(await seen.get(ID)).not.toBeNull();
    now += 20;
    expect(await seen.get('other')).toBeNull();
    expect(await seen.get(ID)).not.toBeNull();
  });

  it('VIEW-13.1: refuses a bad Session id, cursor or time, and starts empty from an unreadable file', async () => {
    const f = file();
    const seen = new ChatSeen({ file: f });
    await expect(seen.set('../x', 'c1', null)).rejects.toBeInstanceOf(ChatSeenError);
    await expect(seen.set(ID, '', null)).rejects.toThrow('Expected');
    await expect(seen.set(ID, 'c1', 'yesterday')).rejects.toThrow('Expected');
    await expect(seen.get(42)).rejects.toThrow('Invalid session id.');
    // An id that names an Object member is just a key.
    expect(await seen.get('constructor')).toBeNull();
    await seen.set('constructor', 'c1', null);
    expect(await seen.get('constructor')).toEqual({ cursor: 'c1', at: null });
    const broken = file();
    await new ChatSeen({ file: broken }).set(ID, 'c1', null);
    writeFileSync(broken, '{not json');
    const fresh = new ChatSeen({ file: broken });
    expect(await fresh.get(ID)).toBeNull();
    // Kept aside, not lost.
    expect(readFileSync(`${broken}.broken`, 'utf8')).toBe('{not json');
    await fresh.set(ID, 'c2', null);
    expect(await new ChatSeen({ file: broken }).get(ID)).toEqual({ cursor: 'c2', at: null });
    // A file it can't read now is never written over.
    const locked = file();
    await new ChatSeen({ file: locked }).set(ID, 'c1', null);
    chmodSync(locked, 0o000);
    const blind = new ChatSeen({ file: locked });
    expect(await blind.get(ID)).toBeNull();
    await blind.set('other', 'c9', null);
    chmodSync(locked, 0o600);
    expect(JSON.parse(readFileSync(locked, 'utf8')).sessions).toHaveProperty(ID);
  });

  it('SIDE-13.1: keeps when you saw each chat (its view opened, or you left it), read back after a restart; an older record counts its last use', async () => {
    const f = file();
    let now = 1_793_880_000_000;
    const seen = new ChatSeen({ file: f, now: () => now });
    // Nothing read yet: no answer, and the first ask starts reading the file.
    expect(seen.viewedAt(ID)).toBeNull();
    await seen.set(ID, 'c1', now - 5000);
    expect(seen.viewedAt(ID)).toBe(now);
    expect(JSON.parse(readFileSync(f, 'utf8')).sessions[ID]).toMatchObject({ cursor: 'c1', viewed: now });
    now += 60_000;
    await seen.get(ID); // the view opens again
    expect(seen.viewedAt(ID)).toBe(now);
    expect(seen.viewedAt('never-opened')).toBeNull();
    // Saves are queued, so after the next one the file has the opening's time too.
    await seen.set('other', 'c9', null);
    const again = new ChatSeen({ file: f, now: () => now });
    await again.get('other');
    expect(again.viewedAt(ID)).toBe(now);
    // A record written before `viewed` existed: its last use is when you saw it.
    writeFileSync(f, JSON.stringify({ v: 1, sessions: { [ID]: { cursor: 'c1', at: null, used: 1_793_000_000_000 } } }));
    const older = new ChatSeen({ file: f, now: () => now });
    expect(older.viewedAt(ID)).toBeNull();
    await older.get('other');
    expect(older.viewedAt(ID)).toBe(1_793_000_000_000);
  });

  it('SIDE-13.1: a first opening counts as seeing the chat: a record with no entry, so still no divider, kept over a restart', async () => {
    const f = file();
    let now = 1_793_880_000_000;
    const seen = new ChatSeen({ file: f, now: () => now });
    expect(await seen.get(ID)).toBeNull();
    expect(seen.viewedAt(ID)).toBe(now);
    // Saves are queued: after the next one the file has the opening.
    await seen.set('other', 'c9', null);
    expect(JSON.parse(readFileSync(f, 'utf8')).sessions[ID]).toEqual({ cursor: null, at: null, used: now, viewed: now });
    now += 60_000;
    const again = new ChatSeen({ file: f, now: () => now });
    expect(await again.get(ID)).toBeNull();
    expect(again.viewedAt(ID)).toBe(now);
    await again.set(ID, 'c1', null);
    expect(await again.get(ID)).toEqual({ cursor: 'c1', at: null });
  });

  it('SIDE-13.1: leaving counts from when the tab left, never later than now, and never moves the time back', async () => {
    const f = file();
    let now = 1_793_880_000_000;
    const seen = new ChatSeen({ file: f, now: () => now });
    // Left at 2000, the Session finished at 2100, the save came in at 2200: seen at 2000, so still Unread.
    await seen.set(ID, 'c1', null, now - 200);
    expect(seen.viewedAt(ID)).toBe(now - 200);
    // A time ahead of the server's clock counts as now.
    await seen.set(ID, 'c2', null, now + 60_000);
    expect(seen.viewedAt(ID)).toBe(now);
    // Opened in another tab, then an older tab's save comes in: the later time stays.
    now += 10_000;
    await seen.get(ID);
    await seen.set(ID, 'c3', null, now - 5_000);
    expect(seen.viewedAt(ID)).toBe(now);
    expect(await seen.get(ID)).toEqual({ cursor: 'c3', at: null });
    // Without `left` (a tab from before this change), the save's time.
    now += 10_000;
    await seen.set(ID, 'c4', null);
    expect(seen.viewedAt(ID)).toBe(now);
    await expect(seen.set(ID, 'c5', null, 'just now')).rejects.toThrow('Expected');
    await expect(seen.set(ID, 'c5', null, Number.NaN)).rejects.toBeInstanceOf(ChatSeenError);
  });

  it("SIDE-13.1: a record file the server can't read gives no time for any Session", async () => {
    const locked = file();
    await new ChatSeen({ file: locked }).set(ID, 'c1', null);
    chmodSync(locked, 0o000);
    const blind = new ChatSeen({ file: locked });
    await blind.get(ID);
    await blind.set(ID, 'c2', null);
    expect(blind.viewedAt(ID)).toBeNull();
    chmodSync(locked, 0o600);
  });
});
