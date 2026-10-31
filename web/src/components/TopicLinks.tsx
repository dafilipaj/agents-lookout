import type { NewMember } from '@shared/topics.ts';
import { Layers, Plus } from 'lucide-react';
import { useContext } from 'react';
import { Button } from '@/components/ui/button';
import { chipVariants } from '@/components/ui/chip';
import { RowAction, RowSettling } from '@/components/ui/icon-button';
import { topicsOf, useTopics } from '@/lib/topics';
import { cn } from '@/lib/utils';

/**
 * TOPIC-2.1: "Add to Topic" on an expanded Work row, History result or Library row: a mouse target in
 * the row's buttons, as its other buttons are; `A` does the same from the keyboard.
 */
export function AddToTopicAction({ members, label, enabled = true }: { members: readonly NewMember[]; label: string; enabled?: boolean }) {
  const topics = useTopics();
  if (!topics) return null;
  return <RowAction data-action="add-to-topic" label="Add to Topic" icon={<Plus />} tip="Add to Topic (A)" enabled={enabled && members.length > 0} onPress={() => topics.addTo(members, label)} />;
}

/**
 * TOPIC-2.2: the same in the Session header and a past Session's view. A Session without a session id
 * (`<harness>:<pid>`) can't be added: the button is disabled, and its tooltip says why.
 */
export function AddToTopicButton({ member, label }: { member: NewMember | null; label: string }) {
  const topics = useTopics();
  if (!topics) return null;
  const tip = member ? 'Add to Topic' : "This Session has no session id until its first prompt, so it can't be added to a Topic yet.";
  return (
    <Button
      variant="outline"
      size="xs"
      className="h-7 shrink-0 gap-1.5 px-2 text-meta"
      title={tip}
      aria-label="Add to Topic"
      aria-disabled={member ? undefined : true}
      data-action="add-to-topic"
      onClick={() => member && topics.addTo([member], label)}
    >
      <Layers className="size-3.5" />
      <span className="@max-[26rem]:sr-only">Add to Topic</span>
    </Button>
  );
}

/**
 * TOPIC-2.5: the Topics an expanded row's item is in (a Library row's: any of its Sessions'), each a
 * chip; a click opens the Topics tab on that Topic. A collapsed row shows none.
 */
export function TopicChips({ members, labelClass }: { members: readonly NewMember[]; labelClass?: string }) {
  const topics = useTopics();
  const settling = useContext(RowSettling);
  if (!topics) return null;
  const list = topicsOf(topics.byMember, members);
  if (!list.length) return null;
  return (
    <div className="flex min-w-0 items-start gap-2 text-meta text-muted-foreground" data-field="topic-chips">
      <span className={cn('shrink-0 pt-0.5', labelClass)}>Topics</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {list.map((t) => (
          <span
            key={t.id}
            role="button"
            title={`Open ${t.title} in Topics`}
            data-topic-id={t.id}
            onClick={(e) => {
              e.stopPropagation();
              if (!settling && e.detail <= 1) topics.open(t.id);
            }}
            className={cn(chipVariants({ tone: 'neutral' }), 'max-w-full cursor-pointer hover:bg-accent')}
          >
            <span className="truncate">{t.title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
