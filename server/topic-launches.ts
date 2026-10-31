import { STARTED_REASON, rowMember } from '../shared/topics.ts';
import type { LaunchTopic, SessionRow } from '../shared/types.ts';
import { TopicsError } from './topics.ts';

/** A start Fleet never reports (failed, dismissed) is forgotten after this long. */
export const TOPIC_LAUNCH_TTL_MS = 60 * 60_000;

export interface TopicLaunchesOptions {
  topics: {
    /** Whether the Topic exists, in either state. */
    has(id: string): boolean;
    /** TOPIC-5.2: adds the Session with its reason; false when it already was a member. */
    addStarted(id: string, member: NonNullable<ReturnType<typeof rowMember>>, reason: string): boolean;
  };
  now?: () => number;
  warn?: (message: string) => void;
}

interface Expected {
  topic: LaunchTopic;
  at: number;
  /** Set once the launcher reports the start: the Session's row, by Harness and process. */
  row: { harness: string; pid: number } | null;
}

/**
 * TOPIC-5.2: a Session Lookout starts for a Topic is added to it once Fleet reports it with a
 * session id. Kept in memory: a restart between the start and Fleet's report loses it, and the
 * Session is recommended instead (TOPIC-9).
 */
export class TopicLaunches {
  private readonly expected = new Map<string, Expected>();
  private readonly opts: TopicLaunchesOptions;
  private readonly now: () => number;

  constructor(opts: TopicLaunchesOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** Checks the request's Topic before the start; throws a TopicsError for one that's gone. */
  check(topic: unknown): LaunchTopic | null {
    if (topic === undefined || topic === null) return null;
    const t = topic as Record<string, unknown>;
    if (typeof t !== 'object' || typeof t.id !== 'string' || (t.via !== 'topic' && t.via !== 'task')) throw new TopicsError(400, 'Invalid Topic.');
    if (!this.opts.topics.has(t.id)) throw new TopicsError(400, 'That Topic is gone: pick another, or none.');
    return { id: t.id, via: t.via };
  }

  /**
   * Before the start is sent, so a Fleet report that beats the answer still finds it. False for a
   * launch id already expected: that start is refused, and the one it would replace is kept.
   */
  expect(launchId: string, topic: LaunchTopic): boolean {
    if (this.expected.has(launchId)) return false;
    this.expected.set(launchId, { topic, at: this.now(), row: null });
    return true;
  }

  /** The start failed: nothing will be reported. */
  forget(launchId: string): void {
    this.expected.delete(launchId);
  }

  /** The launcher's `started` pairs: each start's Session row, found in the list Fleet just gave. */
  started(pairs: readonly { launchId: string; sessionId: string }[], rows: readonly SessionRow[]): void {
    for (const p of pairs) {
      const e = this.expected.get(p.launchId);
      const row = rows.find((r) => r.id === p.sessionId);
      if (e && row) e.row = { harness: row.harness, pid: row.pid };
    }
  }

  /**
   * After every list: a reported start whose row now has a session id is added, and forgotten. A
   * Codex Session gets its id after its first prompt, so its row is followed by Harness and process.
   * Called before candidates are recorded, so it never becomes a recommendation (TOPIC-9.1).
   */
  observe(rows: readonly SessionRow[]): void {
    const now = this.now();
    for (const [launchId, e] of this.expected) {
      // Only a start Fleet never reported is dropped by age: a reported Codex Session is followed
      // until its first prompt gives it an id, however long that takes.
      if (!e.row && now - e.at > TOPIC_LAUNCH_TTL_MS) {
        this.expected.delete(launchId);
        continue;
      }
      if (!e.row) continue;
      const { harness, pid } = e.row;
      const row = rows.find((r) => r.harness === harness && r.pid === pid);
      if (!row) {
        this.expected.delete(launchId); // it ended before it had an id
        continue;
      }
      const member = rowMember(row);
      if (!member) continue;
      this.expected.delete(launchId);
      try {
        if (this.opts.topics.has(e.topic.id)) this.opts.topics.addStarted(e.topic.id, member, STARTED_REASON[e.topic.via]);
      } catch (err) {
        // TOPIC-8.4: a store that fails here leaves the rest of Lookout running.
        (this.opts.warn ?? console.error)(`lookout: adding a started Session to its Topic failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
