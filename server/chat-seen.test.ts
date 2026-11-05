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
});
