import { MAX_EDGE_LABEL, MAX_TOPIC_TITLE, type Topic, type TopicEdge, type TopicMember, type TopicPosition, type TopicsView, sortTopics } from '@shared/topics.ts';
import type { SessionRow } from '@shared/types.ts';
import { ArrowRight, LayoutGrid, Pencil, Plus } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/loading';
import { SessionMarker } from '@/components/ui/session-marker';
import { MEMBER_R, NODE_H, NODE_W, type Point, arrange, border, bounds, placeMissing, ring } from '@/lib/graph';
import { liveRow, memberCounts, memberName, sharedLabel, sharedPairs, topicMarker } from '@/lib/topics';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';
import { PlainView } from './Shell';
import { TaskStatusDot } from './TaskStatusDot';
import { PrIcon } from './WorkPanel';

type SessionMember = Extract<TopicMember, { kind: 'session' }>;

export interface TopicGraphProps {
  view: TopicsView | null;
  sessions: ReadonlyMap<string, SessionRow>;
  /** The Topic selected in the tab (TOPIC-8.1): its node is marked. */
  selected: string | null;
  onSelect(id: string): void;
  /** TOPIC-7.1: the Topics tab's "Archived" toggle. */
  archived: boolean;
  onArchived(archived: boolean): void;
  createTopic(title: string): Promise<Topic>;
  linkTopics(from: string, to: string, label: string | null): Promise<void>;
  editEdge(topicId: string, edit: { other: string; label?: string | null; reverse?: true }): Promise<void>;
  unlinkTopics(topicId: string, other: string): Promise<void>;
  placeTopics(positions: readonly ({ id: string } & TopicPosition)[]): Promise<void>;
  /** TOPIC-7.3: a Session member node does what its chip does: open it live, else resume it. */
  onOpenSession(member: SessionMember, live: boolean): Promise<void>;
  /** TOPIC-10.1: a double-click on a node, or Enter on an expanded one: its Topic's view. */
  onOpen(id: string): void;
  keyboardEnabled: boolean;
}

/** A press that moves less than this is a click, not a drag. */
const DRAG_PX = 4;
/** Before the pane is measured (and in tests): the room the graph aims for. */
const FALLBACK = { width: 800, height: 560 };

type Drag =
  | { kind: 'node'; id: string; pointer: number; from: { x: number; y: number }; start: Point; moved: boolean; box: Box }
  | { kind: 'edge'; from: string; at: Point; box: Box };
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const openInBrowser = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
const nodeId = (id: string) => `topic-node-${id}`;

/**
 * TOPIC-7: the Topics graph, in the main pane at `/topics`. One node per Open Topic (Archived ones
 * behind the tab's toggle), an arrow per Edge from its first Topic to its second, dashed lines for
 * Topics that share a member (TOPIC-6.3). SVG drawn here, no graph library (Technical approach).
 */
export function TopicGraph(props: TopicGraphProps) {
  const { view, onSelect, archived, onArchived } = props;
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmArrange, setConfirmArrange] = useState(false);
  const all = view?.state === 'ok' ? view.topics : [];

  let body;
  if (!view) body = <Loading label="Loading…" className="items-center px-4 py-8 text-center" />;
  else if (view.state === 'error') body = <Alert title="Topics can't be opened" detail={`${view.reason ?? ''} ${view.path}`.trim()} className="m-5" data-field="topics-error" />;
  else if (!all.length) {
    body = (
      <EmptyState
        role="status"
        title="No Topics yet"
        hint="A Topic gathers the Sessions, PRs and Tasks of one piece of work. Each one is a node here."
        action={
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New Topic
          </Button>
        }
      />
    );
  } else if (!archived && !all.some((t) => t.state === 'open')) {
    body = <EmptyState role="status" title="Nothing to show" hint="Archived Topics are hidden. Turn on Archived to show them." />;
  } else {
    body = <Canvas {...props} topics={all} edges={view.edges} pruned={view.pruned} onProblem={setProblem} arrangeAsked={confirmArrange} onArranged={() => setConfirmArrange(false)} />;
  }

  return (
    <PlainView
      aria-label="Topics graph"
      header={
        <>
          <h1 className="text-title font-semibold tracking-tight">Topics</h1>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-1.5 text-meta text-muted-foreground">
              <input type="checkbox" checked={archived} onChange={(e) => onArchived(e.target.checked)} className="size-3.5" />
              Archived
            </label>
            <Button variant="outline" size="sm" className="h-7" disabled={!all.length} onClick={() => setConfirmArrange(true)} data-action="arrange">
              <LayoutGrid />
              Arrange
            </Button>
            <Button variant="outline" size="sm" className="h-7" disabled={view?.state !== 'ok'} onClick={() => setCreating(true)} data-action="new-topic">
              <Plus />
              New Topic
            </Button>
          </div>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {problem && <Alert title={problem} className="mx-5 mt-3" data-field="graph-problem" />}
        {body}
      </div>
      <NewTopic
        open={creating}
        onClose={() => setCreating(false)}
        create={(title) =>
          props.createTopic(title).then((t) => {
            setCreating(false);
            onSelect(t.id);
          })
        }
      />
    </PlainView>
  );
}

/** "New Topic" from the graph: a title, then its node is placed and selected. */
function NewTopic({ open, onClose, create }: { open: boolean; onClose(): void; create(title: string): Promise<unknown> }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('A Topic needs a title.');
    setBusy(true);
    setError(null);
    create(title)
      .then(() => setTitle(''))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't make the Topic."))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-3 p-4 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="text-title">New Topic</DialogTitle>
        <DialogDescription className="text-meta">Its node is placed clear of the others.</DialogDescription>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
          <Input autoFocus aria-label="Topic title" placeholder="Title" maxLength={MAX_TOPIC_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" />
          {error && <Alert title={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Making…' : 'Make'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CanvasProps extends TopicGraphProps {
  topics: readonly Topic[];
  edges: readonly TopicEdge[];
  pruned: readonly string[];
  onProblem(message: string | null): void;
  /** "Arrange" was pressed: ask, then lay every node out again. */
  arrangeAsked: boolean;
  onArranged(): void;
}

function Canvas({ topics, edges, pruned, sessions, selected, onSelect, archived, onProblem, arrangeAsked, onArranged, keyboardEnabled, ...api }: CanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const size = measured ?? FALLBACK;
  /** Where nodes are while dragged, or after, until the server has them (TOPIC-7.2). */
  const [local, setLocal] = useState<ReadonlyMap<string, Point>>(new Map());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<TopicEdge | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // The room inside the scroll bars: the graph fills it, and scrolls once it's larger.
      if (el.clientWidth > 0 && el.clientHeight > 0) setMeasured({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => sortTopics(topics).filter((t) => archived || t.state === 'open'), [topics, archived]);
  // TOPIC-7.2: a node with no position is placed once, clear of the others, and stored. Clear of the
  // hidden Archived ones too, so turning Archived on never shows two nodes on one spot.
  const { at, missing } = useMemo(() => {
    const m = new Map<string, Point>();
    const unplaced: Topic[] = [];
    for (const t of shown) {
      const p = local.get(t.id) ?? t.pos;
      if (p) m.set(t.id, p);
      else unplaced.push(t);
    }
    const hidden = topics.flatMap((t) => (m.has(t.id) || unplaced.includes(t) ? [] : [local.get(t.id) ?? t.pos ?? []].flat()));
    const fresh = placeMissing([...m.values(), ...hidden], unplaced.map((t) => t.id), edges, size);
    unplaced.forEach((t, i) => m.set(t.id, fresh[i]!));
    return { at: m, missing: unplaced.map((t, i) => ({ id: t.id, ...fresh[i]! })) };
  }, [topics, shown, local, edges, size]);
  // A position the server never took (a cancelled drag, a failed save) isn't kept: the node goes back
  // to the server's, and a later move from another tab shows.
  const forget = (ids: readonly string[]) =>
    setLocal((cur) => {
      const next = new Map([...cur].filter(([id]) => !ids.includes(id)));
      return next.size === cur.size ? cur : next;
    });
  const placing = useRef('');
  useEffect(() => {
    const key = missing.map((p) => p.id).join(',');
    // A first layout is as wide as the pane, so it waits for the pane to be measured.
    if (!missing.length || placing.current === key || (!measured && typeof ResizeObserver !== 'undefined')) return;
    placing.current = key;
    setLocal((cur) => new Map([...cur, ...missing.map((p) => [p.id, { x: p.x, y: p.y }] as const)]));
    api.placeTopics(missing).catch((err: unknown) => {
      forget(missing.map((p) => p.id));
      onProblem(err instanceof Error ? err.message : "Couldn't save where the nodes are.");
    });
    // Once per set of new nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, measured]);
  // A position the server now has needs no local copy, so a move from another tab shows: adjusted
  // while rendering, once per new set of Topics, as React's "storing information from previous renders".
  const [seen, setSeen] = useState(topics);
  if (seen !== topics) {
    setSeen(topics);
    const next = new Map(
      [...local].filter(([id, p]) => {
        const t = topics.find((x) => x.id === id);
        return t && !(t.pos && t.pos.x === p.x && t.pos.y === p.y);
      }),
    );
    if (next.size !== local.size) setLocal(next);
  }

  // "Arrange", after its confirmation: every shown node laid out again.
  const arrangeNow = () => {
    const laid = arrange(
      shown.map((t) => t.id),
      edges,
      size,
    );
    const positions = [...laid].map(([id, p]) => ({ id, ...p }));
    setLocal(new Map(laid));
    onArranged();
    onProblem(null);
    api.placeTopics(positions).catch((err: unknown) => {
      forget(positions.map((p) => p.id));
      onProblem(err instanceof Error ? err.message : "Couldn't save where the nodes are.");
    });
  };

  const expandedTopic = shown.find((t) => t.id === expanded) ?? null;
  const members = expandedTopic?.members ?? [];
  const memberAt = expandedTopic ? ring(at.get(expandedTopic.id)!, members.length) : [];
  const box = drag?.box ?? bounds([...at.values(), ...memberAt], size);

  // TOPIC-7.5: drawn at scale 1, a graph unit is a CSS pixel; one larger than the pane scrolls.
  const toGraph = (clientX: number, clientY: number, b: Box): Point => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: b.x + clientX - (r?.left ?? 0), y: b.y + clientY - (r?.top ?? 0) };
  };
  const begin = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onNodeDown = (e: PointerEvent<SVGGElement>, t: Topic) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    begin({ kind: 'node', id: t.id, pointer: e.pointerId, from: { x: e.clientX, y: e.clientY }, start: at.get(t.id)!, moved: false, box });
  };
  const onHandleDown = (e: PointerEvent<SVGCircleElement>, t: Topic) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin({ kind: 'edge', from: t.id, at: at.get(t.id)!, box });
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'edge') return begin({ ...d, at: toGraph(e.clientX, e.clientY, d.box) });
    const dx = e.clientX - d.from.x;
    const dy = e.clientY - d.from.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    const p = { x: Math.round(d.start.x + dx), y: Math.round(d.start.y + dy) };
    dragRef.current = { ...d, moved: true };
    setDrag(dragRef.current);
    setLocal((cur) => new Map(cur).set(d.id, p));
  };
  // TOPIC-7.2: a node dropped is stored where it lies.
  const onUp = () => {
    const d = dragRef.current;
    if (!d) return;
    begin(null);
    if (d.kind !== 'node' || !d.moved) return;
    suppressClick.current = true;
    const p = local.get(d.id);
    if (!p) return;
    api.placeTopics([{ id: d.id, ...p }]).catch((err: unknown) => {
      forget([d.id]);
      onProblem(err instanceof Error ? err.message : "Couldn't save where the node is.");
    });
  };
  // A drag the browser cancels stores nothing, and its node goes back.
  const onCancel = () => {
    const d = dragRef.current;
    begin(null);
    if (d?.kind === 'node' && d.moved) forget([d.id]);
  };
  // TOPIC-7.4: an Edge drawn from a node's handle onto another node goes from the first to the second.
  const onNodeUp = (t: Topic) => {
    const d = dragRef.current;
    if (d?.kind !== 'edge') return;
    begin(null);
    if (d.from === t.id) return;
    onProblem(null);
    api.linkTopics(d.from, t.id, null).catch((err: unknown) => onProblem(err instanceof Error ? err.message : "Couldn't link them."));
  };
  // TOPIC-7.1, TOPIC-7.3: a click selects the Topic (in the tab too) and expands its node to its members.
  const press = (t: Topic) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSelect(t.id);
    setExpanded((cur) => (cur === t.id ? null : t.id));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardEnabled || e.defaultPrevented) return;
    if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      const id = expanded;
      setExpanded(null);
      document.getElementById(nodeId(id))?.focus();
    }
  };
  const openMember = (m: TopicMember) => {
    if (m.kind === 'pr') return openInBrowser(m.ref.url);
    if (m.kind === 'task') return m.snapshot.url && openInBrowser(m.snapshot.url);
    if (m.kind !== 'session' || pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)) return;
    onProblem(null);
    api.onOpenSession(m, liveRow(m, sessions) !== null).catch((err: unknown) => onProblem(err instanceof Error ? err.message : "Couldn't open its Session."));
  };

  const title = (id: string) => topics.find((t) => t.id === id)?.title ?? 'a Topic';
  const shownIds = new Set(shown.map((t) => t.id));
  const visibleEdges = edges.filter((e) => shownIds.has(e.from) && shownIds.has(e.to));
  const shared = sharedPairs(shown, edges);

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-auto select-none" onKeyDown={onKeyDown} data-testid="topic-graph">
      <svg
        ref={svgRef}
        role="group"
        aria-label={`${shown.length} Topics, ${visibleEdges.length} Edges`}
        width={box.width}
        height={box.height}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        className={cn('block touch-none', drag?.kind === 'node' && drag.moved && 'cursor-grabbing')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        data-box={`${box.x} ${box.y} ${box.width} ${box.height}`}
      >
        <defs>
          <marker id="topic-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" className="text-muted-foreground">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {/* TOPIC-6.3: shared members, dashed, no direction, never stored. */}
        {shared.map((p) => {
          const a = at.get(p.a)!;
          const b = at.get(p.b)!;
          const s = border(b, a);
          const t = border(a, b);
          return (
            <g key={`${p.a}~${p.b}`} data-field="shared-line" className="text-muted-foreground">
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="currentColor" strokeWidth={1} strokeDasharray="4 4" />
              <foreignObject x={(a.x + b.x) / 2 - 90} y={(a.y + b.y) / 2 - 10} width={180} height={20} className="pointer-events-none overflow-visible">
                <div className="flex h-full items-center justify-center">
                  <span className="truncate rounded-sm bg-background px-1 text-caption text-muted-foreground">{sharedLabel(p)}</span>
                </div>
              </foreignObject>
            </g>
          );
        })}
        {/* TOPIC-7.1: an arrow per Edge, from its first Topic to its second, with its label. */}
        {visibleEdges.map((e) => {
          const a = at.get(e.from)!;
          const b = at.get(e.to)!;
          const s = border(b, a);
          const t = border(a, b);
          const name = `Edge from ${title(e.from)} to ${title(e.to)}${e.label ? `, ${e.label}` : ''}`;
          return (
            <g key={`${e.from}>${e.to}`} data-field="edge" data-from={e.from} data-to={e.to} className="text-muted-foreground">
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="currentColor" strokeWidth={1.5} markerEnd="url(#topic-arrow)" />
              <foreignObject x={(a.x + b.x) / 2 - 90} y={(a.y + b.y) / 2 - 11} width={180} height={22} className="pointer-events-none overflow-visible">
                <div className="flex h-full items-center justify-center">
                  <button
                    type="button"
                    aria-label={name}
                    title="Edit, reverse or unlink"
                    onClick={() => setEditing(e)}
                    className="pointer-events-auto inline-flex max-w-full items-center gap-1 truncate rounded-sm border border-border bg-background px-1.5 text-caption text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    data-field="edge-label"
                  >
                    {e.label ?? <Pencil aria-hidden className="size-3 text-muted-foreground" />}
                  </button>
                </div>
              </foreignObject>
            </g>
          );
        })}
        {drag?.kind === 'edge' && (
          <line x1={at.get(drag.from)!.x} y1={at.get(drag.from)!.y} x2={drag.at.x} y2={drag.at.y} stroke="currentColor" strokeWidth={1.5} strokeDasharray="2 3" className="pointer-events-none text-primary" markerEnd="url(#topic-arrow)" />
        )}
        {shown.map((t) => (
          <Node
            key={t.id}
            topic={t}
            at={at.get(t.id)!}
            selected={t.id === selected}
            expanded={t.id === expanded}
            target={drag?.kind === 'edge' && drag.from !== t.id}
            sessions={sessions}
            onDown={(e) => onNodeDown(e, t)}
            onUp={() => onNodeUp(t)}
            onHandleDown={(e) => onHandleDown(e, t)}
            onPress={() => press(t)}
            onOpen={() => api.onOpen(t.id)}
          />
        ))}
        {/* TOPIC-7.3: the expanded node's members, small, around it. */}
        {expandedTopic &&
          members.map((m, i) => (
            <MemberNode key={m.key} member={m} at={memberAt[i]!} center={at.get(expandedTopic.id)!} sessions={sessions} pruned={m.kind === 'session' && pruned.includes(`${m.ref.harness}:${m.ref.sessionId}`)} onPress={() => openMember(m)} />
          ))}
      </svg>
      <EdgeDialog
        edge={editing}
        title={title}
        onClose={() => setEditing(null)}
        save={(e, label) => api.editEdge(e.from, { other: e.to, label })}
        reverse={(e) => api.editEdge(e.from, { other: e.to, reverse: true })}
        unlink={(e) => api.unlinkTopics(e.from, e.to)}
      />
      <Dialog open={arrangeAsked} onOpenChange={(next) => !next && onArranged()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogTitle className="text-title">Arrange every node?</DialogTitle>
          <DialogDescription className="text-body leading-5">Every node shown moves to a new place. Where you dragged them isn't kept, and there's no undo.</DialogDescription>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onArranged}>
              Cancel
            </Button>
            <Button size="sm" onClick={arrangeNow}>
              Arrange
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface NodeProps {
  topic: Topic;
  at: Point;
  selected: boolean;
  expanded: boolean;
  /** An Edge is being drawn and could end here. */
  target: boolean;
  sessions: ReadonlyMap<string, SessionRow>;
  onDown(e: PointerEvent<SVGGElement>): void;
  onUp(): void;
  onHandleDown(e: PointerEvent<SVGCircleElement>): void;
  onPress(): void;
  onOpen(): void;
}

/** TOPIC-7.1: a Topic's node: its Session marker, title and member counts; a handle to draw an Edge from (TOPIC-7.4). */
function Node({ topic, at, selected, expanded, target, sessions, onDown, onUp, onHandleDown, onPress, onOpen }: NodeProps) {
  const marker = topicMarker(topic, sessions);
  const counts = memberCounts(topic.members);
  return (
    <g
      id={nodeId(topic.id)}
      role="button"
      tabIndex={0}
      aria-label={[topic.title, counts, topic.state === 'archived' && 'archived'].filter(Boolean).join(', ')}
      aria-pressed={selected}
      aria-expanded={expanded}
      data-topic-id={topic.id}
      data-x={at.x}
      data-y={at.y}
      transform={`translate(${at.x - NODE_W / 2} ${at.y - NODE_H / 2})`}
      className={cn('group cursor-grab outline-none', topic.state === 'archived' && 'opacity-60')}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onClick={onPress}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        // TOPIC-10.1: Enter on an expanded node opens its Topic; otherwise it acts as a click.
        if (e.key === 'Enter' && expanded) onOpen();
        else onPress();
      }}
    >
      <foreignObject width={NODE_W} height={NODE_H} className="overflow-visible">
        <div
          className={cn(
            'flex size-full min-w-0 flex-col justify-center gap-0.5 rounded-md border bg-card px-2.5 text-card-foreground shadow-xs group-focus-visible:ring-2 group-focus-visible:ring-ring/50',
            selected ? 'border-primary ring-1 ring-primary' : 'border-border',
            target && 'border-dashed border-primary',
          )}
          data-field="node"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex size-3.5 shrink-0">{marker && <SessionMarker aria-hidden state={marker.state} status={marker.state === 'live' ? marker.status : undefined} since={marker.state === 'live' ? marker.since : null} />}</span>
            <span className="min-w-0 truncate text-body font-medium" title={topic.title}>
              {topic.title}
            </span>
          </span>
          <span className="truncate pl-5 text-caption text-muted-foreground">{counts}</span>
        </div>
      </foreignObject>
      <circle
        cx={NODE_W}
        cy={NODE_H / 2}
        r={5}
        role="presentation"
        aria-label={`Draw an Edge from ${topic.title}`}
        className={cn('cursor-crosshair fill-background stroke-primary opacity-0 group-hover:opacity-100', selected && 'opacity-100')}
        strokeWidth={1.5}
        onPointerDown={onHandleDown}
        data-field="handle"
      />
    </g>
  );
}

/** TOPIC-7.3: a member as a small node: its kind's icon and, for a Session, its Status marker. */
function MemberNode({ member, at, center, sessions, pruned, onPress }: { member: TopicMember; at: Point; center: Point; sessions: ReadonlyMap<string, SessionRow>; pruned: boolean; onPress(): void }) {
  const row = member.kind === 'session' ? liveRow(member, sessions) : null;
  const name = memberName(member);
  const action = member.kind === 'session' ? (pruned ? `${name}, removed from the index` : `${row ? 'Open' : 'Resume'} ${name}`) : member.kind === 'pr' ? `Open ${name} on GitHub` : `Open ${name} in Fantastic`;
  const s = border(at, center);
  return (
    <g data-field="member" data-kind={member.kind}>
      <line x1={s.x} y1={s.y} x2={at.x} y2={at.y} stroke="currentColor" strokeWidth={1} className="text-border" />
      <g
        role="button"
        tabIndex={pruned ? -1 : 0}
        aria-label={action}
        aria-disabled={pruned || undefined}
        transform={`translate(${at.x - MEMBER_R} ${at.y - MEMBER_R})`}
        className={cn('group outline-none', pruned ? 'cursor-default opacity-60' : 'cursor-pointer')}
        onClick={onPress}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onPress();
        }}
      >
        <title>{name}</title>
        <foreignObject width={MEMBER_R * 2} height={MEMBER_R * 2} className="overflow-visible">
          <div className="relative flex size-full items-center justify-center rounded-full border border-border bg-card group-hover:bg-accent group-focus-visible:ring-2 group-focus-visible:ring-ring/50">
            {member.kind === 'session' ? <HarnessIcon harness={member.ref.harness} className="size-3.5" /> : member.kind === 'pr' ? <PrIcon chip={null} /> : <TaskStatusDot color={null} milestone={false} />}
            {member.kind === 'session' && (
              <span className="absolute -right-1 -bottom-1 inline-flex">
                <SessionMarker aria-hidden state={row ? 'live' : 'past'} status={row?.status} since={row?.statusSince ?? null} />
              </span>
            )}
          </div>
        </foreignObject>
      </g>
    </g>
  );
}

/** TOPIC-7.4: a click on an Edge's label: edit the label, reverse the Edge or unlink it. */
function EdgeDialog({ edge, title, onClose, save, reverse, unlink }: { edge: TopicEdge | null; title(id: string): string; onClose(): void; save(e: TopicEdge, label: string | null): Promise<void>; reverse(e: TopicEdge): Promise<void>; unlink(e: TopicEdge): Promise<void> }) {
  return (
    <Dialog open={edge !== null} onOpenChange={(next) => !next && onClose()}>
      {edge && (
        <DialogContent className="gap-3 p-4 sm:max-w-md" showCloseButton={false}>
          <EdgeForm key={`${edge.from}>${edge.to}`} edge={edge} title={title} onClose={onClose} save={save} reverse={reverse} unlink={unlink} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function EdgeForm({ edge, title, onClose, save, reverse, unlink }: { edge: TopicEdge; title(id: string): string; onClose(): void; save(e: TopicEdge, label: string | null): Promise<void>; reverse(e: TopicEdge): Promise<void>; unlink(e: TopicEdge): Promise<void> }) {
  const [label, setLabel] = useState(edge.label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (p: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    p()
      .then(onClose)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : fallback))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <DialogTitle className="text-title">Edge</DialogTitle>
      <DialogDescription className="flex min-w-0 items-center gap-1 text-meta">
        <span className="truncate">{title(edge.from)}</span>
        <ArrowRight aria-label="to" className="size-3.5 shrink-0" />
        <span className="truncate">{title(edge.to)}</span>
      </DialogDescription>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => save(edge, label.trim() || null), "Couldn't save the label.");
        }}
        className="flex min-w-0 flex-col gap-3"
      >
        <Input autoFocus aria-label="Label" placeholder="Label, optional: part of, follows, blocks" maxLength={MAX_EDGE_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" />
        {error && <Alert title={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" className="mr-auto" disabled={busy} onClick={() => run(() => unlink(edge), "Couldn't unlink it.")}>
            Unlink
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => run(() => reverse(edge), "Couldn't reverse it.")}>
            Reverse
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}
