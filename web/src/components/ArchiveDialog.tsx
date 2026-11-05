import { MAX_CLOSING, type Topic, type TopicOutcome, sortTopics } from '@shared/topics.ts';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PickerList } from '@/components/ui/picker';

/** TOPIC-1.6: what Archive sends. */
export interface ArchivePatch {
  state: 'archived';
  outcome: TopicOutcome;
  closing: string | null;
  supersededBy?: string;
}

const OUTCOMES: { id: TopicOutcome; label: string }[] = [
  { id: 'done', label: 'Done' },
  { id: 'parked', label: 'Parked' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'superseded', label: 'Superseded by…' },
];

/**
 * TOPIC-1.6: Archive asks how the Topic ended: Done (picked when it looks done), Parked, Dropped or
 * "Superseded by…", which picks the Topic from the Open ones; and an optional closing line. Esc or
 * Cancel archives nothing.
 */
export function ArchiveDialog({
  topic,
  topics,
  looksDone,
  open,
  onOpenChange,
  archive,
  onCloseAutoFocus,
}: {
  topic: Topic;
  topics: readonly Topic[];
  looksDone: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  archive(patch: ArchivePatch): Promise<unknown>;
  /** Where focus goes when it closes: it has no trigger of its own to give focus back to. */
  onCloseAutoFocus?(e: Event): void;
}) {
  // While the archive is sent, Esc doesn't close it, so a refusal still shows (as Delete's dialog does).
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      {open && (
        <DialogContent className="gap-3 p-4 sm:max-w-md" showCloseButton={false} data-field="archive-dialog" onCloseAutoFocus={onCloseAutoFocus}>
          <ArchiveBody topic={topic} topics={topics} looksDone={looksDone} onClose={() => onOpenChange(false)} archive={archive} busy={busy} setBusy={setBusy} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ArchiveBody({ topic, topics, looksDone, onClose, archive, busy, setBusy }: { topic: Topic; topics: readonly Topic[]; looksDone: boolean; onClose(): void; archive(patch: ArchivePatch): Promise<unknown>; busy: boolean; setBusy(busy: boolean): void }) {
  const [outcome, setOutcome] = useState<TopicOutcome | null>(looksDone ? 'done' : null);
  const [by, setBy] = useState<Topic | null>(null);
  const [picking, setPicking] = useState(false);
  const [closing, setClosing] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const others = sortTopics(topics.filter((t) => t.state === 'open' && t.id !== topic.id));
  const ready = outcome !== null && (outcome !== 'superseded' || by !== null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    archive({ state: 'archived', outcome, closing: closing.trim() || null, ...(outcome === 'superseded' && by ? { supersededBy: by.id } : {}) })
      .then(() => {
        setBusy(false);
        onClose();
      })
      .catch((err: unknown) => {
        setBusy(false);
        setProblem(err instanceof Error ? err.message : "Couldn't archive it.");
      });
  };

  if (picking) {
    return (
      <>
        <DialogTitle className="text-title">Superseded by</DialogTitle>
        <DialogDescription className="truncate text-meta">{topic.title}</DialogDescription>
        <PickerList
          filterLabel="Filter Topics"
          items={others.map((t) => ({ id: t.id, label: t.title }))}
          empty="No other Open Topic"
          onPick={(id) => {
            setBy(others.find((t) => t.id === id) ?? null);
            setPicking(false);
          }}
        />
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => setPicking(false)}>
            Back
          </Button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
      <DialogTitle className="text-title">Archive “{topic.title}”</DialogTitle>
      <DialogDescription className="text-body leading-5">How did it end? Its members, notes, summaries and activity stay.</DialogDescription>
      <fieldset className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-body" data-field="outcome">
        <legend className="sr-only">How it ended</legend>
        {OUTCOMES.map((o) => (
          <label key={o.id} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="outcome"
              value={o.id}
              checked={outcome === o.id}
              autoFocus={o.id === (outcome ?? 'done')}
              onChange={() => {
                setOutcome(o.id);
                if (o.id === 'superseded' && !by) setPicking(true);
              }}
              className="size-3.5"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      {outcome === 'superseded' && (
        <p className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground" data-field="superseded-by">
          <span className="min-w-0 truncate">{by ? `By ${by.title}` : 'Pick the Topic that superseded it.'}</span>
          <Button type="button" variant="outline" size="sm" className="h-6" onClick={() => setPicking(true)}>
            {by ? 'Change…' : 'Pick…'}
          </Button>
        </p>
      )}
      <Input aria-label="Closing line" placeholder="Closing line, optional" maxLength={MAX_CLOSING} value={closing} onChange={(e) => setClosing(e.target.value)} className="h-8" />
      {problem && <Alert tone="error" title={problem} />}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || busy}>
          {busy ? 'Archiving…' : 'Archive'}
        </Button>
      </DialogFooter>
    </form>
  );
}
