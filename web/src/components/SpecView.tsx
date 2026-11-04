import { compareClauses, compareModules, definitionName, gist, parseClauses, PREDEFINED_CONCEPTS, wordDiff, type Clause, type Compared, type FunctionalSpec, type PlainAnswer, type PlainConcept, type Touched } from '@shared/plain.ts';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { labelledButtonLook } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { SaveError } from '@/lib/client';
import { routePath } from '@/lib/router';
import { cn } from '@/lib/utils';
import { PlainView } from './Shell';

/** PLAIN-1.7: how often an open Module is read again. */
export const SPEC_POLL_MS = 3000;
/** PLAIN-1.7: how long a clause that just changed stays marked. */
export const JUST_CHANGED_MS = 3000;
/** PLAIN-2.2: how long the pointer may be off a term and its card before the card closes. */
const CLOSE_DELAY_MS = 150;

/** PLAIN-2.5: each Spec view's scroll position by its history entry, so Back returns where it was. */
const scrollByEntry = new Map<string, number>();

/** The current history entry's own id, given to it the first time a Spec view shows in it. */
function entryId(): string {
  const state = (window.history.state ?? {}) as { lookoutEntry?: string };
  if (state.lookoutEntry) return state.lookoutEntry;
  const id = Math.random().toString(36).slice(2);
  window.history.replaceState({ ...state, lookoutEntry: id }, '', window.location.href);
  return id;
}

/** PLAIN-1.1, 2.5: a link to another Module: a plain click opens it here, ⌘-click in a new tab. */
function moduleClick(onOpen: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen();
  };
}

export interface SpecViewProps {
  sessionId: string;
  checkout: string;
  path: string;
  /** PLAIN-3.2: the Session's title, for "Back to …"; null when it's gone. */
  sessionTitle: string | null;
  load(sessionId: string, checkout: string, path: string): Promise<PlainAnswer>;
  setViewed(sessionId: string, checkout: string, path: string, key: string, viewed: boolean): Promise<void>;
  /** PLAIN-3.2: back to the Session's view. */
  onBack(): void;
  /** PLAIN-2.5: another Module of the same Checkout, as a new history entry. */
  onOpenModule(path: string): void;
}

const SECTION_TITLES: Record<string, string> = { definitions: 'Definitions', 'implementation reqs': 'Implementation requirements', 'test reqs': 'Test requirements' };
const NAV_TITLES: Record<string, string> = { definitions: 'Definitions', 'implementation reqs': 'Implementation reqs', 'test reqs': 'Test reqs' };
const sectionId = (key: string) => `plain-${key.replace(/[^a-z0-9]+/gi, '-')}`;
const specAnchor = (id: string) => `plain-s-${id.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const defAnchor = (name: string) => `plain-def-${name.replace(/[^A-Za-z0-9]+/g, '-')}`;
const moduleName = (path: string) => path.replace(/^.*\//, '').replace(/\.plain$/, '');

/** PLAIN-1.5: a Module new since the Branch point compares with nothing, so every clause is added. */
const compare = (a: Pick<PlainAnswer, 'text' | 'baseText'>) => compareModules(a.text, a.baseText ?? (a.text !== null ? '' : null));

/** The texts of every clause, to tell which clauses a new read brought (PLAIN-1.7). */
function clauseTexts(c: Compared): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: readonly Clause[]) => {
    for (const n of nodes) {
      if (n.state !== 'removed') out.add(n.text);
      walk(n.children);
    }
  };
  for (const v of Object.values(c.module.sections)) walk(v);
  for (const v of Object.values(c.module.sectionNotes)) walk(v);
  for (const s of c.module.specs) {
    walk(s.clauses);
    walk(s.tests);
    walk(s.notes);
  }
  return out;
}

/**
 * PLAIN-1 to 4: a Module of a live Session's Checkout, whole, its change since the Branch point
 * marked in place, other Modules' Concepts on hover, and its Viewed box.
 */
export function SpecView({ sessionId, checkout, path, sessionTitle, load, setViewed, onBack, onOpenModule }: SpecViewProps) {
  const [answer, setAnswer] = useState<PlainAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justChanged, setJustChanged] = useState<ReadonlySet<string>>(new Set());
  const [highlight, setHighlight] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const last = useRef<PlainAnswer | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const here = routePath({ name: 'plain', session: sessionId, checkout, path });
  const hrefOf = useCallback((p: string) => routePath({ name: 'plain', session: sessionId, checkout, path: p }), [sessionId, checkout]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let clear: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      try {
        const next = await load(sessionId, checkout, path);
        if (!alive) return;
        const before = last.current;
        last.current = next;
        setError(null);
        if (before && (before.text !== next.text || before.baseText !== next.baseText)) {
          // PLAIN-1.7: the clauses this read brought are marked for a moment.
          const was = clauseTexts(compare(before));
          const now = clauseTexts(compare(next));
          setJustChanged(new Set([...now].filter((t) => !was.has(t))));
          if (clear) clearTimeout(clear);
          clear = setTimeout(() => alive && setJustChanged(new Set()), JUST_CHANGED_MS);
        }
        setAnswer((a) => (a && JSON.stringify(a) === JSON.stringify(next) ? a : next));
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        // PLAIN-1.8: a Module the server refuses now (gone, too large) shows no content; a lost
        // connection keeps the last read on screen under the error.
        if (err instanceof SaveError && err.status !== null && err.status < 500) {
          last.current = null;
          setAnswer(null);
        }
      }
      if (alive) timer = setTimeout(() => void read(), SPEC_POLL_MS);
    };
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (clear) clearTimeout(clear);
    };
  }, [load, sessionId, checkout, path]);

  const toggleViewed = useCallback(async () => {
    const a = last.current;
    if (!a || saving) return;
    const next = !a.viewed;
    setSaving(true);
    try {
      await setViewed(sessionId, checkout, path, a.key, next);
      // Only the answer it was saved for takes it: a read that brought a newer text meanwhile stands.
      const apply = (x: PlainAnswer | null) => (x && x.key === a.key ? { ...x, viewed: next, changedSinceViewed: next ? false : x.changedSinceViewed } : x);
      last.current = apply(last.current);
      setAnswer(apply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [saving, setViewed, sessionId, checkout, path]);

  // PLAIN-4.1: V toggles Viewed, with focus outside a text field and no dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      void toggleViewed();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleViewed]);

  const compared = useMemo(() => (answer ? compare(answer) : null), [answer]);
  // PLAIN-2.5: the position is kept as you scroll and put back once the Module is first shown.
  const restored = useRef(false);
  useEffect(() => {
    const box = scroller.current?.parentElement;
    if (!box || !answer) return;
    let entry = entryId();
    if (!restored.current) {
      restored.current = true;
      const at = scrollByEntry.get(entry);
      if (at) box.scrollTop = at;
    }
    const onScroll = () => scrollByEntry.set(entry, box.scrollTop);
    // Back or Forward between two entries of the same Module keeps this view: it moves to the
    // position of the entry it lands on.
    const onPop = () => {
      const next = entryId();
      if (next === entry) return;
      entry = next;
      box.scrollTop = scrollByEntry.get(next) ?? 0;
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPop);
    return () => {
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPop);
    };
  }, [answer, here]);
  const name = moduleName(path);

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button type="button" className={cn(labelledButtonLook(), 'h-7 shrink-0 text-meta font-normal')} onClick={onBack} data-field="spec-back">
        <ArrowLeft aria-hidden className="size-3.5" />
        <span className="max-w-48 truncate">{sessionTitle ? `Back to ${sessionTitle}` : 'Back'}</span>
      </button>
      <h1 className="min-w-0 flex-1 truncate text-title font-semibold tracking-tight">
        {name}
        <span className="font-normal text-muted-foreground">.plain</span>
      </h1>
      <label className={cn('flex shrink-0 items-center gap-1.5 text-meta', !answer && 'opacity-50')} title="Viewed (V)">
        <Checkbox checked={!!answer?.viewed} disabled={!answer || saving} onChange={() => void toggleViewed()} aria-keyshortcuts="V" data-field="spec-viewed" />
        Viewed
      </label>
    </div>
  );

  return (
    <PlainView aria-label={`Spec ${name}`} header={header} data-view="spec">
      <div ref={scroller} className="@container px-5 py-4">
        {error && <Alert className="mb-3" title={error} />}
        {!answer && !error && <Loading label={`Reading ${name}.plain…`} />}
        {answer && compared && (
          <Module
            answer={answer}
            compared={compared}
            justChanged={justChanged}
            highlight={highlight}
            onlyChanged={onlyChanged}
            onHighlight={setHighlight}
            onOnlyChanged={(v) => {
              setOnlyChanged(v);
              if (v) setHighlight(true);
            }}
            onOpenModule={onOpenModule}
            hrefOf={hrefOf}
          />
        )}
      </div>
    </PlainView>
  );
}

interface Ctx {
  own: ReadonlySet<string>;
  specIds: ReadonlySet<string>;
  answer: PlainAnswer;
  justChanged: ReadonlySet<string>;
  highlight: boolean;
  onlyChanged: boolean;
  onTerm(name: string, el: HTMLElement, how: 'enter' | 'leave' | 'focus' | 'blur'): void;
}

function Module({
  answer,
  compared,
  justChanged,
  highlight,
  onlyChanged,
  onHighlight,
  onOnlyChanged,
  onOpenModule,
  hrefOf,
}: {
  answer: PlainAnswer;
  compared: Compared;
  justChanged: ReadonlySet<string>;
  highlight: boolean;
  onlyChanged: boolean;
  onHighlight(v: boolean): void;
  onOnlyChanged(v: boolean): void;
  onOpenModule(path: string): void;
  hrefOf(path: string): string;
}) {
  const mod = compared.module;
  const own = useMemo(() => new Set((mod.sections.definitions ?? []).flatMap((n) => (definitionName(n.text) ? [definitionName(n.text)!.name] : []))), [mod]);
  const specIds = useMemo(() => new Set(mod.specs.map((s) => s.id)), [mod]);
  const [card, setCard] = useState<{ name: string; el: HTMLElement } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setCard(null), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);
  const onTerm: Ctx['onTerm'] = (name, el, how) => {
    if (how === 'enter' || how === 'focus') {
      cancelClose();
      setCard({ name, el });
    } else closeSoon();
  };
  const ctx: Ctx = { own, specIds, answer, justChanged, highlight, onlyChanged, onTerm };

  const total = compared.stats.added + compared.stats.changed + compared.stats.removed;
  const unchanged = answer.text !== null && answer.text === answer.baseText;
  const showCard = compared.diffed && !unchanged;
  const live = mod.specs.filter((s) => s.state !== 'removed');
  const noted = (k: string) => (mod.sectionNotes[k]?.length ?? 0) > 0;
  const sectionKeys = [...new Set([...Object.keys(mod.sections), ...Object.keys(mod.sectionNotes)])].filter((k) => k !== 'functional specs' && ((mod.sections[k]?.length ?? 0) > 0 || noted(k) || compared.touchedSections.includes(k)));
  const hasSpecs = mod.specs.length > 0 || noted('functional specs');
  const touched = new Set(compared.touchedSections);
  const visible = (k: string) => !onlyChanged || touched.has(k);

  const nav = (
    <nav aria-label="Module" data-slot="spec-nav" className="flex shrink-0 flex-col gap-0.5 text-meta @min-[640px]:sticky @min-[640px]:top-0 @min-[640px]:w-48 @min-[640px]:self-start">
      {showCard && <NavLink href="changes" label="Changes" touched />}
      {sectionKeys.map((k) => (
        <NavLink key={k} href={sectionId(k)} label={NAV_TITLES[k] ?? k} count={(mod.sections[k] ?? []).filter((n) => n.state !== 'removed').length} touched={touched.has(k)} />
      ))}
      {hasSpecs && <NavLink href={sectionId('functional specs')} label="Functional specs" count={live.length} touched={touched.has('functional specs')} />}
      {mod.specs.length > 0 && (
        <ol className="ml-2 flex max-h-[50vh] flex-col overflow-y-auto border-l border-border pl-2">
          {mod.specs
            .filter((s) => !onlyChanged || s.state !== 'same')
            .map((s) => (
              <li key={s.id}>
                <a href={`#${specAnchor(s.id)}`} onClick={jump(specAnchor(s.id))} className={cn('flex min-w-0 gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-accent', s.state !== 'same' && 'font-medium')} data-state={s.state}>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{s.id}</span>
                  <span className="min-w-0 truncate">{s.clauses[0] ? gist(s.clauses[0].text) : ''}</span>
                </a>
              </li>
            ))}
        </ol>
      )}
    </nav>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4 @min-[640px]:flex-row @min-[640px]:items-start @min-[640px]:gap-6" data-highlight={highlight || undefined} data-only-changed={onlyChanged || undefined}>
      {nav}
      <article className="flex min-w-0 max-w-[72rem] flex-1 flex-col gap-5" data-slot="spec-module">
        <header className="flex flex-col gap-1.5">
          <p className="text-meta text-muted-foreground" data-field="spec-where">
            {answer.path} · {answer.checkout.where ? `${answer.checkout.repo} · ${answer.checkout.where}` : answer.checkout.repo}
          </p>
          {(mod.description || compared.oldDescription) && (
            <p className="text-prose" data-field="spec-description">
              {compared.oldDescription !== null && highlight ? <Rewritten old={compared.oldDescription} now={mod.description} ctx={ctx} /> : <Inline text={mod.description} ctx={ctx} />}
            </p>
          )}
          {(mod.import.length > 0 || mod.requires.length > 0) && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground" data-field="spec-imports">
              {mod.import.length > 0 && (
                <span>
                  imports <ModuleLinks names={mod.import} from={answer.path} missing={answer.missing} onOpen={onOpenModule} hrefOf={hrefOf} />
                </span>
              )}
              {mod.requires.length > 0 && (
                <span>
                  requires <ModuleLinks names={mod.requires} from={answer.path} missing={answer.missing} onOpen={onOpenModule} hrefOf={hrefOf} />
                </span>
              )}
            </p>
          )}
          {answer.text === null && <Alert tone="info" title="This Module was deleted since the Branch point." detail="Its text at the Branch point is shown, every clause removed." />}
          {answer.baseText === null && answer.text !== null && compared.diffed && <p className="text-meta text-muted-foreground">New since the Branch point.</p>}
        </header>

        {answer.changedSinceViewed && !answer.viewed && <Alert tone="info" title="Changed since you viewed it" data-field="spec-changed-since" />}

        {showCard && (
          <section id="changes" aria-label="Changes" className="flex flex-col gap-2 rounded-md border border-border p-3" data-slot="spec-changes">
            <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body font-semibold">
              Changes
              <span className="text-meta font-normal text-muted-foreground">against {answer.base} (Branch point)</span>
              <span className="ml-auto flex gap-3 text-meta font-normal" data-field="spec-tally">
                <span className="text-diff-added-text">{compared.stats.added} added</span>
                <span className="text-muted-foreground">{compared.stats.changed} changed</span>
                <span className="text-diff-removed-text">{compared.stats.removed} removed</span>
              </span>
            </h2>
            {total === 0 ? (
              <p className="text-meta text-muted-foreground">No clause of this Module differs.</p>
            ) : (
              <ul className="flex flex-col text-meta">
                {compared.stats.touched.map((t, i) => (
                  <li key={`${t.where}-${i}`} className="flex gap-2">
                    <a href={`#${touchedAnchor(t, specIds)}`} onClick={jump(touchedAnchor(t, specIds))} className="min-w-24 underline-offset-2 hover:underline">
                      {t.where.replace(/ (tests|notes)$/, '')}
                    </a>
                    <span className="text-muted-foreground">{touchedWhat(t)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-4 text-meta">
              <label className="flex items-center gap-1.5">
                <Checkbox checked={highlight} onChange={(e) => onHighlight(e.target.checked)} data-field="spec-highlight" />
                Highlight changes
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={onlyChanged} onChange={(e) => onOnlyChanged(e.target.checked)} data-field="spec-only-changed" />
                Only what changed
              </label>
            </div>
          </section>
        )}

        {mod.notes.length > 0 && !onlyChanged && (
          <aside className="flex flex-col gap-1 border-l-2 border-border pl-3 text-prose text-muted-foreground">
            {mod.notes.map((n, i) => (
              <p key={i}>
                <Inline text={n} ctx={ctx} />
              </p>
            ))}
          </aside>
        )}

        {sectionKeys.filter(visible).map((k) => (
          <section key={k} id={sectionId(k)} aria-label={SECTION_TITLES[k] ?? k} className="flex flex-col gap-2" data-touched={touched.has(k) || undefined}>
            <SectionTitle title={SECTION_TITLES[k] ?? k} count={(mod.sections[k] ?? []).filter((n) => n.state !== 'removed').length} />
            {k === 'definitions' ? <Definitions nodes={mod.sections[k] ?? []} ctx={ctx} /> : <ClauseList nodes={mod.sections[k] ?? []} ctx={ctx} />}
            {mod.sectionNotes[k] && <Notes nodes={mod.sectionNotes[k]} ctx={ctx} />}
          </section>
        ))}

        {hasSpecs && visible('functional specs') && (
          <section id={sectionId('functional specs')} aria-label="Functional specs" className="flex flex-col gap-3" data-touched={touched.has('functional specs') || undefined}>
            <SectionTitle title="Functional specs" count={live.length} />
            {mod.sectionNotes['functional specs'] && <Notes nodes={mod.sectionNotes['functional specs']} ctx={ctx} />}
            {mod.specs
              .filter((s) => !onlyChanged || s.state !== 'same')
              .map((s) => (
                <Spec key={s.id} spec={s} ctx={ctx} />
              ))}
          </section>
        )}

        {mod.loose.length > 0 && !onlyChanged && (
          <section aria-label="Not in a section" className="flex flex-col gap-2" data-slot="spec-loose">
            <SectionTitle title="Not in a section" count={mod.loose.length} />
            <pre className="whitespace-pre-wrap font-mono text-meta text-muted-foreground">{mod.loose.join('\n')}</pre>
          </section>
        )}

        {!sectionKeys.length && !hasSpecs && !mod.loose.length && <p className="text-meta text-muted-foreground">This Module is empty.</p>}
      </article>
      <ConceptCard card={card} answer={answer} onEnter={cancelClose} onLeave={closeSoon} onClose={() => setCard(null)} onOpenModule={onOpenModule} hrefOf={hrefOf} />
    </div>
  );
}

function jump(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };
}

function NavLink({ href, label, count, touched }: { href: string; label: string; count?: number; touched?: boolean }) {
  return (
    <a href={`#${href}`} onClick={jump(href)} className={cn('flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-accent', touched && 'font-medium')} data-touched={touched || undefined}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular-nums text-muted-foreground">{count}</span>}
      {touched && <span aria-label="changed" className="size-1.5 shrink-0 rounded-full bg-foreground" />}
    </a>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 border-b border-border pb-1 text-body font-semibold">
      {title}
      <span className="text-meta font-normal tabular-nums text-muted-foreground">{count}</span>
    </h2>
  );
}

function touchedAnchor(t: Touched, specIds: ReadonlySet<string>): string {
  const where = t.where.replace(/ (tests|notes)$/, '');
  if (t.where === 'description') return 'changes';
  if (specIds.has(where)) return specAnchor(where);
  return sectionId(where);
}

function touchedWhat(t: Touched): string {
  if (t.newSpec) return 'new spec';
  if (t.removedSpec) return 'spec removed';
  const what = [t.added && `${t.added} added`, t.changed && `${t.changed} changed`, t.removed && `${t.removed} removed`].filter(Boolean).join(', ');
  return t.where.endsWith(' tests') ? `acceptance tests: ${what}` : t.where.endsWith(' notes') ? `notes: ${what}` : what;
}

/** PLAIN-2.5: an import or requires name as a link to its Module, from the importing Module's folder. */
function ModuleLinks({ names, from, missing, onOpen, hrefOf }: { names: readonly string[]; from: string; missing: readonly string[]; onOpen(path: string): void; hrefOf(path: string): string }) {
  return (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          {missing.includes(n) ? (
            <span className="text-foreground" title={`${n} isn't in this Checkout`}>
              {n}
            </span>
          ) : (
            <a href={hrefOf(resolveFrom(from, n))} className="font-medium text-foreground underline-offset-2 hover:underline" onClick={moduleClick(() => onOpen(resolveFrom(from, n)))}>
              {n}
            </a>
          )}
        </span>
      ))}
    </>
  );
}

/** An import path from the importing Module's folder (PLAIN-2.1), as the server reads it. */
function resolveFrom(from: string, name: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const seg of `${name}.plain`.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function stateClass(state: Clause['state'], ctx: Ctx, text: string): string {
  return cn(
    'rounded-sm px-1 -mx-1',
    ctx.highlight && state === 'added' && 'bg-diff-added-soft',
    ctx.highlight && state === 'removed' && 'bg-diff-removed-soft text-muted-foreground line-through',
    ctx.justChanged.has(text) && 'bg-muted',
  );
}

function Tag({ state, ctx }: { state: Clause['state']; ctx: Ctx }) {
  if (!ctx.highlight || state === 'same') return null;
  return <span className={cn('mr-1.5 text-caption font-medium uppercase', state === 'added' && 'text-diff-added-text', state === 'removed' && 'text-diff-removed-text', state === 'changed' && 'text-muted-foreground')}>{state}</span>;
}

/** PLAIN-1.8: a section's or a spec's `>` notes, quieter than its clauses, marked as clauses are. */
function Notes({ nodes, ctx }: { nodes: readonly Clause[]; ctx: Ctx }) {
  const shown = nodes.filter((n) => (ctx.highlight || n.state !== 'removed') && (!ctx.onlyChanged || n.state !== 'same'));
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-1 border-l-2 border-border pl-3 text-meta text-muted-foreground" data-slot="spec-notes">
      {shown.map((n, i) => (
        <p key={`${i}-${n.text.slice(0, 40)}`} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined}>
          <span className={stateClass(n.state, ctx, n.text)}>
            <Tag state={n.state} ctx={ctx} />
            <ClauseBody n={n} ctx={ctx} />
          </span>
        </p>
      ))}
    </div>
  );
}

const hasChange = (nodes: readonly Clause[]): boolean => nodes.some((n) => n.state !== 'same' || hasChange(n.children));

function ClauseList({ nodes, ctx, className }: { nodes: readonly Clause[]; ctx: Ctx; className?: string }) {
  const shown = nodes.filter((n) => (ctx.highlight || n.state !== 'removed') && (!ctx.onlyChanged || n.state !== 'same' || hasChange(n.children)));
  if (!shown.length) return null;
  return (
    <ul className={cn('flex list-disc flex-col gap-1 pl-5 text-prose marker:text-muted-foreground', className)}>
      {shown.map((n, i) => (
        <li key={`${i}-${n.text.slice(0, 40)}`} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined}>
          <span className={stateClass(n.state, ctx, n.text)}>
            <Tag state={n.state} ctx={ctx} />
            <ClauseBody n={n} ctx={ctx} />
          </span>
          {n.children.length > 0 && <ClauseList nodes={n.children} ctx={ctx} className="mt-1" />}
        </li>
      ))}
    </ul>
  );
}

function ClauseBody({ n, ctx }: { n: Clause; ctx: Ctx }) {
  if (n.state === 'changed' && n.oldText !== undefined && ctx.highlight) return <Rewritten old={n.oldText} now={n.text} ctx={ctx} />;
  return <Inline text={n.text} ctx={ctx} />;
}

/** PLAIN-1.6: a rewritten clause, its deleted and inserted words marked. */
function Rewritten({ old, now, ctx }: { old: string; now: string; ctx: Ctx }) {
  return (
    <>
      {wordDiff(old, now).map((p, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {p.k === 'eq' ? (
            <Inline text={p.t} ctx={ctx} />
          ) : p.k === 'ins' ? (
            <ins className="bg-diff-added-soft no-underline">
              <Inline text={p.t} ctx={ctx} />
            </ins>
          ) : (
            <del className="bg-diff-removed-soft text-muted-foreground">
              <Inline text={p.t} ctx={ctx} />
            </del>
          )}
        </span>
      ))}
    </>
  );
}

function Definitions({ nodes, ctx }: { nodes: readonly Clause[]; ctx: Ctx }) {
  const shown = nodes.filter((n) => (ctx.highlight || n.state !== 'removed') && (!ctx.onlyChanged || n.state !== 'same' || hasChange(n.children)));
  return (
    <dl className="flex flex-col gap-3">
      {shown.map((n, i) => {
        const d = definitionName(n.text);
        const old = n.oldText !== undefined ? n.oldText.replace(/^:[^:]+:\s*/, '') : undefined;
        return (
          <div key={`${i}-${d?.name ?? n.text.slice(0, 20)}`} id={d ? defAnchor(d.name) : undefined} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined} className="flex flex-col gap-0.5">
            <dt className="text-body font-semibold">
              <Tag state={n.state} ctx={ctx} />
              {d?.name ?? ''}
            </dt>
            <dd className="flex flex-col gap-1 text-prose">
              <span className={stateClass(n.state, ctx, n.text)}>
                {n.state === 'changed' && old !== undefined && ctx.highlight ? <Rewritten old={old} now={d?.body ?? n.text} ctx={ctx} /> : <Inline text={d?.body ?? n.text} ctx={ctx} />}
              </span>
              {n.children.length > 0 && <ClauseList nodes={n.children} ctx={ctx} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Spec({ spec, ctx }: { spec: FunctionalSpec; ctx: Ctx }) {
  return (
    <article id={specAnchor(spec.id)} aria-label={spec.id} data-state={spec.state} className={cn('flex flex-col gap-1.5 rounded-md px-3 py-2', spec.state !== 'same' && 'border border-border')}>
      <h3 className="flex min-w-0 items-baseline gap-2 text-body font-semibold">
        <span className="tabular-nums">{spec.id}</span>
        <span className="min-w-0 truncate font-normal text-muted-foreground">{spec.clauses[0] ? gist(spec.clauses[0].text) : ''}</span>
        {spec.state === 'added' && ctx.highlight && <span className="text-caption font-medium uppercase text-diff-added-text">new spec</span>}
        {spec.state === 'removed' && ctx.highlight && <span className="text-caption font-medium uppercase text-diff-removed-text">spec removed</span>}
      </h3>
      <ClauseList nodes={spec.clauses} ctx={ctx} />
      {spec.notes.length > 0 && <Notes nodes={spec.notes} ctx={ctx} />}
      {spec.tests.length > 0 && (
        <div className="flex flex-col gap-1 pl-2">
          <h4 className="text-meta font-medium text-muted-foreground">Acceptance tests</h4>
          <ClauseList nodes={spec.tests} ctx={ctx} />
        </div>
      )}
    </article>
  );
}

/** PLAIN-1.4: code spans, `:Concept:` terms and `§N.M` references inside a clause's text. */
function Inline({ text, ctx }: { text: string; ctx: Ctx }) {
  const out: ReactNode[] = [];
  text.split(/(`[^`]*`)/).forEach((part, i) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
      out.push(
        <code key={i} className="rounded-sm bg-muted px-1 font-mono">
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    part.split(/(:[A-Z][A-Za-z0-9+.\-_]*:|§\d+(?:\.\d+)*)/).forEach((bit, j) => {
      const key = `${i}-${j}`;
      const concept = /^:([A-Z][A-Za-z0-9+.\-_]*):$/.exec(bit);
      if (concept) {
        out.push(<Term key={key} name={concept[1]!} ctx={ctx} />);
        return;
      }
      if (/^§\d/.test(bit)) {
        out.push(
          ctx.specIds.has(bit) ? (
            <a key={key} href={`#${specAnchor(bit)}`} onClick={jump(specAnchor(bit))} className="underline underline-offset-2">
              {bit}
            </a>
          ) : (
            <span key={key}>{bit}</span>
          ),
        );
        return;
      }
      if (bit) out.push(bit);
    });
  });
  return <>{out}</>;
}

/** PLAIN-1.4, 2.2: a Concept: a link to its own definition, a predefined one, or another Module's on hover. */
function Term({ name, ctx }: { name: string; ctx: Ctx }) {
  if (ctx.own.has(name)) {
    return (
      <a href={`#${defAnchor(name)}`} onClick={jump(defAnchor(name))} className="font-medium underline underline-offset-2" data-term="own">
        {name}
      </a>
    );
  }
  if (PREDEFINED_CONCEPTS.has(name) && !ctx.answer.concepts[name]) {
    return (
      <span className="font-medium text-muted-foreground" title="Predefined by plain" data-term="predefined">
        {name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="font-medium underline decoration-dotted underline-offset-2"
      data-term="other"
      aria-haspopup="dialog"
      onPointerEnter={(e) => ctx.onTerm(name, e.currentTarget, 'enter')}
      onPointerLeave={(e) => ctx.onTerm(name, e.currentTarget, 'leave')}
      onFocus={(e) => ctx.onTerm(name, e.currentTarget, 'focus')}
      onBlur={(e) => {
        // Focus moving into the card keeps it open.
        if (e.relatedTarget instanceof Node && document.querySelector('[data-slot="concept-card"]')?.contains(e.relatedTarget)) return;
        ctx.onTerm(name, e.currentTarget, 'blur');
      }}
    >
      {name}
    </button>
  );
}

/** PLAIN-2.2 to 2.4: one card for whichever term the pointer or focus is on. */
function ConceptCard({
  card,
  answer,
  onEnter,
  onLeave,
  onClose,
  onOpenModule,
  hrefOf,
}: {
  card: { name: string; el: HTMLElement } | null;
  answer: PlainAnswer;
  onEnter(): void;
  onLeave(): void;
  onClose(): void;
  onOpenModule(path: string): void;
  hrefOf(path: string): string;
}) {
  // The card's anchor is the term under the pointer or focus: a ref object made per term.
  const anchor = useMemo(() => ({ current: card?.el ?? null }), [card]);
  const c = card ? answer.concepts[card.name] : undefined;
  return (
    <Popover open={!!card} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor virtualRef={anchor as { current: HTMLElement }} />
      {card && (
        <PopoverContent
          side="bottom"
          align="start"
          data-slot="concept-card"
          aria-label={`${card.name}, defined in ${c ? moduleName(c.module) : 'no Module this one reads'}`}
          className="flex max-h-[50vh] w-[min(32rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={() => card.el.focus()}
          onPointerEnter={onEnter}
          onPointerLeave={onLeave}
          onFocusOutside={(e) => {
            if (e.target === card.el) e.preventDefault();
          }}
        >
          <ConceptBody name={card.name} concept={c} missing={answer.missing} onOpenModule={onOpenModule} hrefOf={hrefOf} />
        </PopoverContent>
      )}
    </Popover>
  );
}

function ConceptBody({ name, concept, missing, onOpenModule, hrefOf }: { name: string; concept: PlainConcept | undefined; missing: readonly string[]; onOpenModule(path: string): void; hrefOf(path: string): string }) {
  if (!concept) {
    return (
      <>
        <p className="text-body font-semibold">{name}</p>
        <p className="text-meta text-muted-foreground" data-field="concept-missing">
          {missing.length
            ? `Not in the Modules this one reads here; it may be defined in ${missing.map((m) => `\`${m}\``).join(', ')}, which ${missing.length === 1 ? "isn't" : "aren't"} in this Checkout.`
            : 'Not defined in any Module this one reads.'}
        </p>
      </>
    );
  }
  const changed = concept.baseLines !== null && concept.baseLines.join('\n') !== concept.lines.join('\n');
  const added = concept.baseLines === null;
  const removed = concept.lines.length === 0;
  const ctx: Ctx = { own: new Set(), specIds: new Set(), answer: { concepts: {} } as PlainAnswer, justChanged: new Set(), highlight: true, onlyChanged: false, onTerm: () => {} };
  const body = removed ? parseClauses(concept.baseLines ?? []).map(asRemoved) : changed ? compareClauses(concept.baseLines!, concept.lines) : parseClauses(concept.lines);
  return (
    <>
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 text-body font-semibold">{name}</p>
        <a href={hrefOf(`${concept.module}.plain`)} className={cn(labelledButtonLook(), 'h-6 text-meta font-normal')} onClick={moduleClick(() => onOpenModule(`${concept.module}.plain`))}>
          Open {moduleName(concept.module)}
        </a>
      </div>
      <p className="text-meta text-muted-foreground">
        Defined in <span className="text-foreground">{concept.module}</span>
      </p>
      {(changed || added || removed) && (
        <p className="text-meta font-medium" data-field="concept-changed">
          {removed ? 'Removed in this branch' : added ? 'Added in this branch' : 'Changed in this branch'}
        </p>
      )}
      <ClauseList nodes={body.map(stripName)} ctx={ctx} className="pl-4" />
    </>
  );
}

const asRemoved = (n: Clause): Clause => ({ ...n, state: 'removed', children: n.children.map(asRemoved) });

/** A definition's first clause without its `:Name:`, which the card's title already says. */
function stripName(n: Clause, i: number): Clause {
  if (i !== 0) return n;
  return { ...n, text: n.text.replace(/^:[^:]+:\s*/, ''), oldText: n.oldText?.replace(/^:[^:]+:\s*/, '') };
}
