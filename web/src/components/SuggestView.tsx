import { MAX_SUGGEST_NOTE, MAX_TOPIC_TITLE, type Proposal, type ProposalAccept, type SuggestPreview, type TopicsView, formatCost, modelName } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import { ArrowRight, Check, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CommandBlock } from '@/components/ui/command-block';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/loading';
import { formatAge } from '@/lib/time';
import { MemberMark } from './Recommendations';
import { PlainView } from './Shell';

export interface SuggestViewProps {
  view: TopicsView | null;
  sessions: ReadonlyMap<string, SessionRow>;
  now: number;
  suggestPreview(): Promise<SuggestPreview>;
  suggest(): Promise<unknown>;
  cancelSuggest(): Promise<unknown>;
  acceptProposal(id: string, accept: ProposalAccept): Promise<unknown>;
  dismissProposal(id: string): Promise<unknown>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** TOPIC-14.2: "27 Sessions, 3 PRs and 2 Tasks in no Topic". */
function previewWords(p: SuggestPreview): string {
  const parts = [plural(p.sessions, 'Session', 'Sessions'), plural(p.prs, 'PR', 'PRs'), plural(p.tasks, 'Task', 'Tasks')];
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)} in no Topic`;
}

/**
 * TOPIC-14: the Suggest view, in the main pane. What a run would look at, "Suggest" (or Cancel while
 * one goes), why the last one failed, and the pending proposals, each edited, then accepted or
 * dismissed whole (TOPIC-14.5, 14.6).
 */
export function SuggestView({ view, sessions, now, ...props }: SuggestViewProps) {
  const state = view?.state === 'ok' ? view.suggest : undefined;
  const running = state?.running ?? false;
  const proposals = state?.proposals ?? [];
  const [preview, setPreview] = useState<SuggestPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Read again when a run ends: what it proposed may since have been accepted.
  const runAt = state?.run?.writtenAt ?? null;
  useEffect(() => {
    if (running) return;
    let live = true;
    props.suggestPreview().then(
      (p) => live && setPreview(p),
      (err: unknown) => live && setProblem(err instanceof Error ? err.message : "Couldn't read what's in no Topic."),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per run, not per render
  }, [running, runAt, proposals.length]);
  const act = (p: Promise<unknown>, fallback: string) => {
    setProblem(null);
    p.catch((err: unknown) => setProblem(err instanceof Error ? err.message : fallback));
  };
  const ordered = [...proposals].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'new' ? -1 : 1));
  const topics = view?.state === 'ok' ? view.topics : [];
  return (
    <PlainView
      aria-label="Suggest Topics"
      data-testid="suggest-view"
      header={
        <>
          <h1 className="min-w-0 flex-1 truncate text-title font-semibold">Suggest Topics</h1>
          {running ? (
            <>
              <Loading label="Suggesting…" />
              <Button variant="outline" size="sm" data-action="cancel-suggest" onClick={() => act(props.cancelSuggest(), "Couldn't cancel it.")}>
                <X />
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" data-action="suggest" disabled={view?.state !== 'ok'} onClick={() => act(props.suggest(), "Couldn't start suggesting.")}>
              {state?.run ? <RefreshCw /> : <Sparkles />}
              {state?.run ? 'Suggest again' : 'Suggest'}
            </Button>
          )}
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 px-4 py-4">
        <p className="text-meta text-muted-foreground" data-field="suggest-preview">
          {preview ? previewWords(preview) : 'Reading what’s in no Topic…'}
        </p>
        {problem && <Alert title={problem} data-field="suggest-problem" />}
        {state?.error && !running && (
          <Alert title="No Topics were suggested" detail={state.error.reason} data-field="suggest-error">
            {state.error.fix && <CommandBlock>{state.error.fix}</CommandBlock>}
          </Alert>
        )}
        {ordered.length === 0 && state?.run && !running && <p className="text-body text-muted-foreground">Nothing is waiting. Everything proposed was accepted or dismissed.</p>}
        {ordered.map((p) => (
          <ProposalCard key={p.id} proposal={p} topics={topics} sessions={sessions} accept={(a) => props.acceptProposal(p.id, a)} dismiss={() => props.dismissProposal(p.id)} />
        ))}
        {state?.run && (
          <p className="text-meta text-muted-foreground" data-field="suggest-run">
            {[modelName(state.run.model), state.run.costUsd === null ? null : formatCost(state.run.costUsd), `${formatAge(now - state.run.writtenAt)} ago`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </PlainView>
  );
}

/** TOPIC-14.5: one proposal: a new Topic's fields, or the Topic it adds to; members and Edges ticked; Accept and Dismiss. */
function ProposalCard({ proposal: p, topics, sessions, accept, dismiss }: { proposal: Proposal; topics: TopicsView['topics']; sessions: ReadonlyMap<string, SessionRow>; accept(a: ProposalAccept): Promise<unknown>; dismiss(): Promise<unknown> }) {
  const [title, setTitle] = useState(p.title ?? '');
  const [note, setNote] = useState(p.note ?? '');
  const [members, setMembers] = useState(() => new Set(p.members.map((m) => m.key)));
  const [edges, setEdges] = useState(() => new Set(p.edges.map((e) => e.to)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const target = p.topicId ? topics.find((t) => t.id === p.topicId) : undefined;
  const gone = p.kind === 'add' && target?.state !== 'open';
  const run = (work: Promise<unknown>, fallback: string) => {
    setBusy(true);
    setProblem(null);
    work.catch((err: unknown) => setProblem(err instanceof Error ? err.message : fallback)).finally(() => setBusy(false));
  };
  const toggle = (set: Set<string>, key: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };
  const heading = p.kind === 'new' ? 'New Topic' : `Add to ${target?.title ?? 'a Topic that’s gone'}`;
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3" data-proposal={p.id} aria-label={p.kind === 'new' ? `New Topic: ${title || p.title}` : heading}>
      <h2 className="text-meta font-medium text-muted-foreground">{heading}</h2>
      {p.kind === 'new' && (
        <>
          <Input aria-label="Title" value={title} maxLength={MAX_TOPIC_TITLE} onChange={(e) => setTitle(e.target.value)} className="text-body font-medium" />
          <Input aria-label="Note" value={note} maxLength={MAX_SUGGEST_NOTE} placeholder="One line: what the work is" onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      {gone && <Alert tone="info" layout="inline" title="That Topic was archived or deleted since: this proposal can only be dismissed." />}
      <ul className="flex min-w-0 flex-col gap-1" aria-label="Members">
        {p.members.map((m) => (
          <li key={m.key}>
            <label className="flex min-w-0 items-center gap-2 text-body">
              <Checkbox checked={members.has(m.key)} disabled={busy || gone} onChange={() => toggle(members, m.key, setMembers)} />
              <MemberMark member={m} sessions={sessions} />
              <span className="min-w-0 truncate" title={m.snapshot.title}>
                {m.kind === 'pr' ? `${m.snapshot.repo} #${m.snapshot.number} ${m.snapshot.title}` : m.snapshot.title}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {p.edges.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-1" aria-label="Edges">
          {p.edges.map((e) => (
            <li key={e.to}>
              <label className="flex min-w-0 items-center gap-2 text-body">
                <Checkbox checked={edges.has(e.to)} disabled={busy} onChange={() => toggle(edges, e.to, setEdges)} />
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">
                  {topics.find((t) => t.id === e.to)?.title ?? 'a Topic that’s gone'} ({e.label})
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {p.why && <p className="text-meta text-muted-foreground">{p.why}</p>}
      {problem && <Alert layout="inline" title={problem} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || gone}
          data-action="accept-proposal"
          onClick={() => run(accept({ ...(p.kind === 'new' ? { title, note } : {}), members: [...members], edges: [...edges] }), "Couldn't accept it.")}
        >
          <Check />
          Accept
        </Button>
        <Button variant="outline" size="sm" disabled={busy} data-action="dismiss-proposal" onClick={() => run(dismiss(), "Couldn't dismiss it.")}>
          <X />
          Dismiss
        </Button>
      </div>
    </article>
  );
}
