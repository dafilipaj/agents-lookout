import { describe, expect, it } from 'vitest';
import { sidebarOrder, sortSessions } from './order.ts';
import type { SessionRow, Status } from './types.ts';

const row = (id: string, status: Status, statusSince: number | null): SessionRow => ({
  id,
  pid: 1,
  harness: 'claude',
  title: id,
  status,
  waitingFor: null,
  statusSince,
  contextPct: null,
  cwd: null,
  git: null,
  locationShown: { repo: true, where: false },
  backend: 'tmux',
  controllable: true,
  ownHost: true,
  model: null,
  effort: null,
  subagents: null, activity: null, backgroundShell: false,
  procStart: null,
  memoryGrowthBytes: null, pendingModel: null, pendingEffort: null,
  modelAt: null,
});

describe('sidebar order', () => {
  it('SIDE-13.4: Unread rows come after Needs you and before Busy, newest status change first; the rest keep SIDE-3.1', () => {
    const rows = [
      row('idle-read', 'idle', 900),
      row('busy', 'busy', 800),
      row('unread-old', 'idle', 100),
      row('needs', 'needs-you', 50),
      row('unread-new', 'idle', 700),
      row('unknown', 'unknown', 1000),
    ];
    const unread = new Set(['unread-old', 'unread-new', 'busy']);
    // A Busy Session in the set ranks as Busy: only an Idle one is Unread.
    expect(sortSessions(rows, unread).map((r) => r.id)).toEqual(['needs', 'unread-new', 'unread-old', 'busy', 'idle-read', 'unknown']);
    expect(sortSessions(rows).map((r) => r.id)).toEqual(['needs', 'busy', 'idle-read', 'unread-new', 'unread-old', 'unknown']);
    // Each section on its own: a View only Unread row stays under "View only".
    const viewOnly = { ...row('v-unread', 'idle', 999), controllable: false };
    expect(sidebarOrder([...rows, viewOnly], new Set([...unread, 'v-unread'])).map((r) => r.id).slice(-1)).toEqual(['v-unread']);
  });

  it('SIDE-9.2: running and finished counts do not affect Status order or order within a Status', () => {
    const rows = [row('idle-old', 'idle', 100), row('busy', 'busy', 200), row('idle-new', 'idle', 300)];
    expect(sortSessions(rows.map((r, i) => ({ ...r, subagents: { running: 3 - i, finished: i } }))).map((r) => r.id))
      .toEqual(['busy', 'idle-new', 'idle-old']);
  });

  it('SIDE-3.1: Needs you → Busy → Idle → Unknown, most recent status change first within each', () => {
    const rows = [
      row('idle-old', 'idle', 100),
      row('unknown', 'unknown', 900),
      row('busy-old', 'busy', 200),
      row('needs-old', 'needs-you', 300),
      row('idle-new', 'idle', 800),
      row('busy-new', 'busy', 700),
      row('needs-new', 'needs-you', 600),
      row('idle-untimed', 'idle', null),
    ];
    expect(sortSessions(rows).map((r) => r.id)).toEqual([
      'needs-new',
      'needs-old',
      'busy-new',
      'busy-old',
      'idle-new',
      'idle-old',
      'idle-untimed',
      'unknown',
    ]);
  });
});
