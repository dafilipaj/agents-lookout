import type { Topic } from '@shared/topics.ts';
import { RESTATE_LINE } from '@shared/topics.ts';
import { describe, expect, it } from 'vitest';
import { NOW } from '@/test/helpers';
import { type LaunchDraft, withViewedTopic } from './launch';

/** Synthetic Topics only. */
const topic = (n: number, over: Partial<Topic> = {}): Topic =>
  ({ id: `t${n}`, title: `Topic ${n}`, notes: `Notes ${n}.`, state: 'open', createdAt: NOW - 1e6, updatedAt: NOW, members: [], ...over }) as Topic;
const text = (t: Topic) => [t.notes, `Topic: ${t.id} ${t.title}`, RESTATE_LINE].join('\n\n');
const draft = (over: Partial<LaunchDraft> = {}): LaunchDraft => ({ directory: '~/p', harness: 'claude', model: '', name: '', prompt: '', ...over });

describe('N in a Topic view (TOPIC-16.3)', () => {
  const a = topic(1);
  const b = topic(2);

  it('TOPIC-16.3: picks the viewed Open Topic, its prompt above what was typed; the same draft when the view is no Open Topic', () => {
    expect(withViewedTopic(draft({ prompt: 'Mine.' }), b, [a, b])).toEqual(draft({ prompt: `${text(b)}\n\nMine.`, topic: { id: 't2', via: 'topic' }, topicText: text(b) }));
    const d = draft({ prompt: 'Mine.' });
    expect(withViewedTopic(d, null, [a, b])).toBe(d);
    expect(withViewedTopic(d, topic(3, { state: 'archived' }), [a, b])).toBe(d);
  });

  it('TOPIC-16.3: a draft with an Open Topic picked, or one deleted since, keeps it; one archived since counts as none, and the viewed Topic\'s prompt takes its place', () => {
    const onA = draft({ prompt: text(a), topic: { id: 't1', via: 'topic' }, topicText: text(a) });
    expect(withViewedTopic(onA, b, [a, b])).toBe(onA);
    expect(withViewedTopic(onA, b, [b])).toBe(onA);
    expect(withViewedTopic(onA, b, [{ ...a, state: 'archived' }, b])).toEqual(draft({ prompt: text(b), topic: { id: 't2', via: 'topic' }, topicText: text(b) }));
  });
});
