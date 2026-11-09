import type { NewMember } from '@shared/topics.ts';
import { Button } from '@/components/ui/button';
import { useTopics } from '@/lib/topics';
import { ActionIcon } from '@/lib/actions';

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
      variant="quiet"
      size="default"
      className="shrink-0"
      title={tip}
      aria-label="Add to Topic"
      aria-disabled={member ? undefined : true}
      data-action="add-to-topic"
      onClick={() => member && topics.addTo([member], label)}
    >
      <ActionIcon id="add-to-topic" />
      <span className="@max-[26rem]:sr-only">Add to Topic</span>
    </Button>
  );
}
