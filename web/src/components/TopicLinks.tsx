import type { NewMember } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import { ChevronDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { SessionMarker } from '@/components/ui/session-marker';
import { headerTopics, topicMarker, useTopics } from '@/lib/topics';
import { ActionIcon } from '@/lib/actions';

/**
 * TOPIC-2.2: the same in the Session header and a past Session's view: an icon button, as the header's
 * other actions (DS-18.5). A Session without a session id (`<harness>:<pid>`) can't be added: the button
 * is disabled, and its tooltip says why.
 */
export function AddToTopicButton({ member, label }: { member: NewMember | null; label: string }) {
  const topics = useTopics();
  if (!topics) return null;
  return (
    <IconButton
      size="md"
      label="Add to Topic"
      tip={member ? undefined : "This Session has no session id until its first prompt, so it can't be added to a Topic yet."}
      aria-disabled={member ? undefined : true}
      data-action="add-to-topic"
      onClick={() => member && topics.addTo([member], label)}
    >
      <ActionIcon id="add-to-topic" />
    </IconButton>
  );
}

/**
 * TOPIC-16.4: after the Hand off links in the Session header and a past Session's view, the Topics the
 * Session is in, built as `HandoffLinks` is: one is a quiet link with `Layers` and its title, opening its
 * view; several are "N Topics", opening a menu of them, Open ones first, each with its marker. Below 32rem
 * of header a link is its icon alone, its words its tooltip.
 */
export function TopicHeaderLinks({ member, sessions }: { member: NewMember | null; sessions: ReadonlyMap<string, SessionRow> }) {
  const topics = useTopics();
  const list = topics ? headerTopics(topics.byMember, member) : [];
  if (!topics || !list.length) return null;
  if (list.length === 1) {
    const t = list[0]!;
    return (
      <Button
        variant="quiet"
        size="line"
        className="min-w-0 shrink"
        aria-label={`Topic: ${t.title}`}
        title={t.state === 'open' ? t.title : `${t.title} (archived)`}
        data-field="topic-link"
        onClick={() => topics.view(t.id)}
      >
        <Layers aria-hidden />
        <span className="min-w-0 truncate @max-[32rem]:sr-only">{t.title}</span>
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="quiet" size="line" className="min-w-0 shrink" title={`${list.length} Topics`} data-field="topic-link">
          <Layers aria-hidden />
          <span className="min-w-0 truncate @max-[32rem]:sr-only">{list.length} Topics</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* Named "Topics", not after its trigger, which Radix would name it otherwise. */}
      <DropdownMenuContent align="start" aria-label="Topics" aria-labelledby={undefined} className="w-80">
        {list.map((t) => {
          const marker = topicMarker(t, sessions);
          return (
            <DropdownMenuItem key={t.id} onSelect={() => topics.view(t.id)}>
              {marker ? <SessionMarker state={marker.state} status={marker.state === 'live' ? marker.status : undefined} since={marker.state === 'live' ? marker.since : undefined} /> : <span aria-hidden className="size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.state !== 'open' && <span className="shrink-0 text-meta text-muted-foreground">archived</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
