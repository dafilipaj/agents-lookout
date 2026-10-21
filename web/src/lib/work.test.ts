import { describe, expect, it } from 'vitest';
import type { WorkSessionLink } from '@shared/work.ts';
import { sessionToOpen } from './work.ts';

function session(over: Partial<WorkSessionLink> & Pick<WorkSessionLink, 'sessionId'>): WorkSessionLink {
  return {
    harness: 'claude',
    title: over.sessionId,
    createdAt: 100,
    modifiedAt: 100,
    live: false,
    reason: 'started on this Task',
    ...over,
  };
}

describe('the Session a Work row opens', () => {
  it('WORK-2.4: prefers the live Session with latest activity, then later creation on a tie', () => {
    expect(sessionToOpen([
      session({ sessionId: 'old-live', live: true, modifiedAt: 50, createdAt: 80 }),
      session({ sessionId: 'latest-past', live: false, modifiedAt: 300, createdAt: 300 }),
      session({ sessionId: 'latest-live', live: true, modifiedAt: 100, createdAt: 100 }),
      session({ sessionId: 'tie-live', live: true, modifiedAt: 100, createdAt: 200 }),
    ])?.sessionId).toBe('tie-live');
  });

  it('WORK-3.4: opens the past Session with latest activity when Fleet lists no live Session', () => {
    expect(sessionToOpen([
      session({ sessionId: 'older', modifiedAt: 300, createdAt: 300 }),
      session({ sessionId: 'latest', modifiedAt: 400, createdAt: 350 }),
      session({ sessionId: 'tie', modifiedAt: 400, createdAt: 360 }),
    ])?.sessionId).toBe('tie');
    expect(sessionToOpen([])).toBeNull();
  });
});
