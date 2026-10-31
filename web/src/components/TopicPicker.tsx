import { MAX_TOPIC_TITLE, type NewMember, type Topic, sortTopics } from '@shared/topics.ts';
import { type FormEvent, type RefObject, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PickerList } from '@/components/ui/picker';
import { keyOf } from '@/lib/topics';

/** What the picker adds: the row's members, and how the row is named in its title. */
export interface PickTarget {
  members: readonly NewMember[];
  label: string;
  /** The dialog's title; "Add to Topic" when unset. */
  title?: string;
  /** TOPIC-9.4, "Other Topic…": what a pick does instead of adding the members. */
  pick?(topicId: string): Promise<{ added: boolean; title: string }>;
  /** TOPIC-9.1: "Ask Jev which Topic" ("Judge again"), offered only while Jev can be asked. */
  judge?(): Promise<unknown>;
}

export interface TopicPickerProps {
  target: PickTarget | null;
  onClose(): void;
  /** Where focus returns on close: what opened the picker, when it's still on the page. */
  returnFocus?: RefObject<HTMLElement | null>;
  topics: readonly Topic[];
  createTopic(title: string): Promise<Topic>;
  addMember(topicId: string, member: NewMember): Promise<{ added: boolean; title: string }>;
}

const NEW = 'new-topic';
const JUDGE = 'ask-jev';

/**
 * TOPIC-2.1: the Topic picker. Open Topics, most recently changed first, then "New Topic…"; picking
 * one adds the row's members and closes it. TOPIC-2.3: an item already in that Topic changes nothing,
 * and the picker says "Already in <Topic>" and stays open for another pick.
 */
export function TopicPicker({ target, onClose, returnFocus, topics, createTopic, addMember }: TopicPickerProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target && (
        <DialogContent
          className="gap-3 p-4 sm:max-w-md"
          showCloseButton={false}
          onCloseAutoFocus={(e) => {
            const opener = returnFocus?.current;
            if (!opener?.isConnected) return;
            e.preventDefault();
            opener.focus();
          }}
        >
          <PickerBody key={target.members.map(keyOf).join('|')} target={target} onClose={onClose} topics={topics} createTopic={createTopic} addMember={addMember} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PickerBody({ target, onClose, topics, createTopic, addMember }: TopicPickerProps & { target: PickTarget }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const keys = target.members.map(keyOf);
  const open = sortTopics(topics.filter((t) => t.state === 'open'));
  const already = (t: Topic) => keys.length > 0 && keys.every((k) => t.members.some((m) => m.key === k));

  const add = async (topicId: string) => {
    if (target.pick) {
      const r = await target.pick(topicId);
      return { added: r.added, name: r.title };
    }
    let added = false;
    let name = '';
    for (const m of target.members) {
      const r = await addMember(topicId, m);
      added ||= r.added;
      name = r.title;
    }
    return { added, name };
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : "Couldn't add it." });
    } finally {
      setBusy(false);
    }
  };
  const pick = (id: string) => {
    if (id === NEW) return setCreating(true);
    if (id === JUDGE) {
      return void run(async () => {
        await target.judge?.();
        onClose();
      });
    }
    void run(async () => {
      const { added, name } = await add(id);
      if (added) onClose();
      else setMessage({ tone: 'info', text: `Already in ${name}` });
    });
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setMessage({ tone: 'error', text: 'A Topic needs a title.' });
    void run(async () => {
      const topic = await createTopic(title);
      await add(topic.id);
      onClose();
    });
  };

  return (
    <>
      <DialogTitle className="text-title">{creating ? 'New Topic' : (target.title ?? 'Add to Topic')}</DialogTitle>
      <DialogDescription className="truncate text-meta" title={target.label}>
        {target.label}
      </DialogDescription>
      {creating ? (
        <form onSubmit={create} className="flex min-w-0 flex-col gap-3">
          <Input autoFocus aria-label="Topic title" placeholder="Title" maxLength={MAX_TOPIC_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Adding…' : 'Make and add'}
            </Button>
          </div>
        </form>
      ) : (
        <PickerList
          filterLabel="Filter Topics"
          items={[
            ...open.map((t) => ({ id: t.id, label: t.title, ...(already(t) ? { hint: 'already in' } : {}) })),
            { id: NEW, label: 'New Topic…' },
            ...(target.judge ? [{ id: JUDGE, label: 'Ask Jev which Topic', hint: 'billed' }] : []),
          ]}
          keep={(item) => item.id === NEW || item.id === JUDGE}
          onPick={pick}
        />
      )}
      {message && <Alert tone={message.tone} title={message.text} data-field="picker-message" />}
    </>
  );
}
