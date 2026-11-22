import { describe, expect, it } from 'vitest';
import { lastSeen, tabTitle, unreadIds, wentIdleUnseen } from './unread';
import { NOW, row } from '@/test/helpers';

describe('Unread', () => {
  it('SIDE-13.2: Idle and went Idle after you last saw it; never with no record, nor while Busy, Needs you or Unknown, nor where a visible tab shows it', () => {
    const none = new Map<string, number>();
    const finished = row({ id: 'a', status: 'idle', statusSince: NOW, viewedAt: NOW - 60_000 });
    expect(wentIdleUnseen(finished, none)).toBe(true);
    // Seen after it went Idle, or at the same moment: read.
    expect(wentIdleUnseen({ ...finished, viewedAt: NOW + 1 }, none)).toBe(false);
    expect(wentIdleUnseen({ ...finished, viewedAt: NOW }, none)).toBe(false);
    // Never opened in Lookout: no record (null, or a server without the field), and not left here.
    expect(wentIdleUnseen({ ...finished, viewedAt: null }, none)).toBe(false);
    expect(wentIdleUnseen({ ...finished, viewedAt: undefined }, none)).toBe(false);
    for (const status of ['busy', 'needs-you', 'unknown'] as const) expect(wentIdleUnseen({ ...finished, status }, none)).toBe(false);
    expect(wentIdleUnseen({ ...finished, statusSince: null }, none)).toBe(false);
    // The one a visible tab shows isn't Unread there; the others are.
    const other = row({ id: 'b', status: 'idle', statusSince: NOW, viewedAt: NOW - 1 });
    expect([...unreadIds([finished, other], 'a', none)]).toEqual(['b']);
    expect([...unreadIds([finished, other], null, none)]).toEqual(['a', 'b']);
  });

  it("SIDE-13.2, SIDE-13.3: when you last saw it is the later of the server's record and this tab's leaving its view", () => {
    const r = row({ id: 'a', status: 'idle', statusSince: NOW, viewedAt: NOW - 60_000 });
    expect(lastSeen(r, new Map())).toBe(NOW - 60_000);
    expect(lastSeen(r, new Map([['a', NOW + 5]]))).toBe(NOW + 5);
    expect(lastSeen({ ...r, viewedAt: NOW + 9 }, new Map([['a', NOW + 5]]))).toBe(NOW + 9);
    // Left here before the server's record arrived: seen, so not Unread.
    expect(wentIdleUnseen(r, new Map([['a', NOW + 5]]))).toBe(false);
    // Left here, with no record on the server (a save that failed): it counts as opened.
    expect(wentIdleUnseen({ ...r, viewedAt: null }, new Map([['a', NOW - 1]]))).toBe(true);
  });

  it('SIDE-13.6: the tab title adds a dot while any Session is Unread, after the Needs you count', () => {
    expect(tabTitle(2, 3)).toBe('(2) • Lookout');
    expect(tabTitle(0, 1)).toBe('• Lookout');
    expect(tabTitle(2, 0)).toBe('(2) Lookout');
    expect(tabTitle(0, 0)).toBe('Lookout');
  });
});
