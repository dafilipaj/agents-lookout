import type { NewMember } from '@shared/topics.ts';
import { IconButton } from '@/components/ui/icon-button';
import { useTopics } from '@/lib/topics';
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
