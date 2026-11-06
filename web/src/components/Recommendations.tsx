import type { NewMember, Recommendation, RecommendationAction, Topic } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import { ArrowRight, Check, FolderInput, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SessionMarker } from '@/components/ui/session-marker';
import { liveRow } from '@/lib/topics';
import { HarnessIcon } from './HarnessIcon';
import { TaskStatusDot } from './TaskStatusDot';
import { PrIcon } from './WorkPanel';

export interface RecommendationsProps {
  recommendations: readonly Recommendation[];
  topics: readonly Topic[];
  sessions: ReadonlyMap<string, SessionRow>;
  /** In the list at the top, each row names its Topic; inside an expanded Topic it's that one. */
  showTopic: boolean;
  recommend(action: RecommendationAction): Promise<unknown>;
  /** "Other Topic…": the Topic picker, for this recommendation. */
  onOtherTopic(rec: Recommendation): void;
  onProblem(message: string | null): void;
  /** The list's accessible name. */
  label?: string;
}

/**
 * TOPIC-9.4: pending recommendations, newest first: the item as its row would look, the Topic or
 * "New Topic: <title>", and the reason, with Accept, Other Topic… and Dismiss. Nothing is added
 * until you press one (TOPIC-9.5).
 */
export function Recommendations({ recommendations, topics, sessions, showTopic, recommend, onOtherTopic, onProblem, label = 'Recommended' }: RecommendationsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const id = (r: Recommendation) => `${r.key} ${r.topicId ?? 'new'}`;
  const act = (r: Recommendation, action: 'accept' | 'dismiss') => {
    setBusy(id(r));
    onProblem(null);
    recommend({ action, key: r.key, topicId: r.topicId })
      .catch((err: unknown) => onProblem(err instanceof Error ? err.message : "Couldn't save that."))
      .finally(() => setBusy(null));
  };
  return (
    <div role="list" aria-label={label} className="flex min-w-0 flex-col gap-1" data-field="recommendations">
      {recommendations.map((r) => {
        const target = r.topicId === null ? `New Topic: ${r.newTitle}` : (topics.find((t) => t.id === r.topicId)?.title ?? 'a Topic');
        const title = r.member.kind === 'pr' ? `${r.member.snapshot.repo} #${r.member.snapshot.number} ${r.member.snapshot.title}` : r.member.snapshot.title;
        const off = busy === id(r);
        return (
          <div key={id(r)} role="listitem" aria-label={`${title}, for ${target}`} className="flex min-w-0 flex-col gap-0.5" data-field="recommendation">
            <div className="flex min-w-0 items-center gap-1.5">
              <ItemIcon rec={r} sessions={sessions} />
              <span className="min-w-0 truncate text-foreground" title={title} data-field="item">
                {title}
              </span>
            </div>
            {/* The Topic on its own line, so neither it nor the item is cut to a few letters in a 360 px tab. */}
            {showTopic && (
              <div className="flex min-w-0 items-center gap-1.5 pl-0.5">
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium text-foreground" title={target} data-field="target">
                  {target}
                </span>
              </div>
            )}
            <span className="min-w-0 truncate text-muted-foreground" title={r.reason} data-field="reason">
              {r.reason}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button type="button" variant="soft" size="line" disabled={off} onClick={() => act(r, 'accept')}>
                <Check />
                Accept
              </Button>
              <Button type="button" variant="secondary" size="line" disabled={off} onClick={() => onOtherTopic(r)}>
                <FolderInput />
                Other Topic…
              </Button>
              <Button type="button" variant="secondary" size="line" disabled={off} onClick={() => act(r, 'dismiss')}>
                <X />
                Dismiss
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The item's mark, as its row shows it: a Session's Harness and Status, a PR's icon, a Task's dot. */
function ItemIcon({ rec, sessions }: { rec: Recommendation; sessions: ReadonlyMap<string, SessionRow> }) {
  return <MemberMark member={{ ...rec.member, key: rec.key }} sessions={sessions} />;
}

/** An item's mark by its kind (TOPIC-9.4, TOPIC-14.5). */
export function MemberMark({ member: m, sessions }: { member: NewMember & { key: string }; sessions: ReadonlyMap<string, SessionRow> }) {
  if (m.kind === 'session') {
    const row = liveRow({ ...m, addedAt: 0, reason: '' }, sessions);
    return (
      <>
        <HarnessIcon harness={m.ref.harness} />
        <SessionMarker aria-hidden state={row ? 'live' : 'past'} status={row?.status} since={row?.statusSince ?? null} />
      </>
    );
  }
  if (m.kind === 'pr') return <PrIcon chip={null} />;
  return <TaskStatusDot color={null} milestone={false} />;
}

/**
 * TOPIC-9.7: the items set aside after three failed Jev asks, with the latest reason and "Ask again",
 * which puts them all back in the queue. Nothing while none are set aside.
 */
export function JevSetAside({ setAside, recommend, onProblem, className }: { setAside: { count: number; reason: string | null } | undefined; recommend(action: RecommendationAction): Promise<unknown>; onProblem(message: string | null): void; className?: string }) {
  const [asking, setAsking] = useState(false);
  if (!setAside?.count) return null;
  const askAgain = () => {
    setAsking(true);
    onProblem(null);
    recommend({ action: 'ask-again' })
      .catch((err: unknown) => onProblem(err instanceof Error ? err.message : "Couldn't ask Jev again."))
      .finally(() => setAsking(false));
  };
  const items = setAside.count === 1 ? '1 item' : `${setAside.count} items`;
  return (
    <Alert tone="info" icon={TriangleAlert} title={`${items} couldn't be judged by Jev: ${setAside.reason ?? 'no reason given'}`} className={className} data-field="jev-set-aside">
      <div>
        <Button variant="secondary" size="line" disabled={asking} onClick={askAgain}>
          <RotateCcw aria-hidden />
          Ask again
        </Button>
      </div>
    </Alert>
  );
}
