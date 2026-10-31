import type { Recommendation, RecommendationAction, Topic } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import { Check, FolderInput, X } from 'lucide-react';
import { useState } from 'react';
import { labelledButtonLook } from '@/components/ui/icon-button';
import { SessionMarker } from '@/components/ui/session-marker';
import { liveRow } from '@/lib/topics';
import { cn } from '@/lib/utils';
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
              {showTopic && (
                <>
                  <span aria-hidden className="shrink-0 text-muted-foreground">
                    →
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground" title={target} data-field="target">
                    {target}
                  </span>
                </>
              )}
            </div>
            <span className="min-w-0 truncate text-muted-foreground" title={r.reason} data-field="reason">
              {r.reason}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta [&>svg]:size-3.5')} disabled={off} onClick={() => act(r, 'accept')}>
                <Check />
                Accept
              </button>
              <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta [&>svg]:size-3.5')} disabled={off} onClick={() => onOtherTopic(r)}>
                <FolderInput />
                Other Topic…
              </button>
              <button type="button" className={cn(labelledButtonLook(), 'h-6 text-meta [&>svg]:size-3.5')} disabled={off} onClick={() => act(r, 'dismiss')}>
                <X />
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The item's mark, as its row shows it: a Session's Harness and Status, a PR's icon, a Task's dot. */
function ItemIcon({ rec, sessions }: { rec: Recommendation; sessions: ReadonlyMap<string, SessionRow> }) {
  const m = rec.member;
  if (m.kind === 'session') {
    const row = liveRow({ ...m, key: rec.key, addedAt: 0, reason: '' }, sessions);
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
