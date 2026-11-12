import { ABILITY_KEY, compareClauses, compareModules, definitionName, gist, numberSpec, parseClauses, PREDEFINED_CONCEPTS, wordDiff, type AbilityEntry, type AbilityLeafKind, type AbilityRule, type Clause, type Compared, type FunctionalSpec, type PlainAbility, type PlainAnswer, type PlainConcept, type PlainExample, type PlainExampleFrame, type PlainExamplesAnswer, type PlainExampleTest, type PlainPortRow, type PlainSimple, type PlainSimpleAnswer, type PlainSimpleBlock, type PlainSource, type PlainSpecRef, type Touched } from '@shared/plain.ts';
import { formatCost, modelName } from '@shared/topics.ts';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Columns2, ListChecks } from 'lucide-react';
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button, ButtonDivider } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented, type SegmentedChoice } from '@/components/ui/segmented';
import { SaveError } from '@/lib/client';
import { type ChangeKind, firstLine, JUMP_MARGIN_PX, type Mark, stepMark } from '@/lib/marks';
import { plainRoute, routePath, specHash } from '@/lib/router';
import { formatAge, useNow } from '@/lib/time';
import { cropRegion } from '@/lib/plain-shots';
import { cn } from '@/lib/utils';
import { ActionIcon } from '@/lib/actions';
import { ChatRail } from './ChatRail';
import { PlainView } from './Shell';

/** PLAIN-1.7: how often an open Module is read again. */
export const SPEC_POLL_MS = 3000;
/** PLAIN-1.7: how long a clause that just changed stays marked. */
export const JUST_CHANGED_MS = 3000;
/** PLAIN-2.2: how long the pointer may be off a term and its card before the card closes. */
const CLOSE_DELAY_MS = 150;
/** PLAIN-9.3: the room the spec strip takes at the top of the view; a change jumped to lands below it. */
export const STRIP_PX = 36;
/** PLAIN-9.6: how far left of the text's edge the change bars' one gutter sits, and a list's indent, in rem. */
const GUTTER_REM = 0.75;
const INDENT_REM = 1.25;

/** PLAIN-2.5: each Spec view's scroll position by its history entry, so Back returns where it was. */
const scrollByEntry = new Map<string, number>();

/** PLAIN-10.1: the view: only what changed, marked; the whole Module, marked; or the Module after the change, unmarked. */
export type SpecMode = 'changes' | 'whole' | 'clean';
/** PLAIN-10.2: each history entry's view, kept as its scroll position is; a reload starts over. */
const viewByEntry = new Map<string, SpecMode>();
/** The view the current history entry was left in, if it has been seen. */
const entryView = (): SpecMode | null => {
  const id = (window.history.state as { lookoutEntry?: string } | null)?.lookoutEntry;
  return id ? (viewByEntry.get(id) ?? null) : null;
};

/** PLAIN-10.1: each choice's tooltip is its longer wording. */
const VIEW_CHOICES: readonly SegmentedChoice<SpecMode>[] = [
  { id: 'changes', label: 'Changes', tooltip: 'Only what changed, marked' },
  { id: 'whole', label: 'Whole', tooltip: 'The whole Module, its changes marked' },
  { id: 'clean', label: 'Clean', tooltip: 'The Module as it reads after the change, unmarked' },
];
/** PLAIN-10.3: a deleted Module has nothing to read after the change. */
const DELETED_CHOICES: readonly SegmentedChoice<SpecMode>[] = VIEW_CHOICES.map((c) => (c.id === 'clean' ? { ...c, disabled: true, tooltip: 'Deleted in this branch' } : c));

/** PLAIN-8.6, 9.3: the scroll position that puts `target` just below the view's top edge and its strip. */
const belowStrip = (box: HTMLElement, target: HTMLElement) => Math.max(0, target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - JUMP_MARGIN_PX - STRIP_PX);

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
  /** A live Session's Checkout, or a PR (PLAIN-5). */
  source: PlainSource;
  path: string;
  /** PLAIN-3.2: what "Back to …" names: the Session's title, or the PR; null for plain "Back". */
  backTo: string | null;
  /** `fresh` on the view's first read, so a PR's newer push is fetched first (PLAIN-5.3). */
  load(source: PlainSource, path: string, fresh: boolean): Promise<PlainAnswer>;
  setViewed(source: PlainSource, path: string, key: string, viewed: boolean): Promise<void>;
  /** PLAIN-3.2: back to where it was opened from. */
  onBack(): void;
  /** PLAIN-2.5: another Module of the same Checkout or PR, as a new history entry; PLAIN-7.2: at one of its specs. */
  onOpenModule(path: string, at?: string): void;
  /** PLAIN-11: a Module's examples, on a Session's Checkout and a PR's (PLAIN-11.15); absent where they aren't offered. */
  examples?: ExamplesApi;
  /** PLAIN-14: a Module's changed specs in simple words; absent where it isn't offered. */
  simple?: SimpleApi;
}

/** PLAIN-14.1, 14.13: reading, starting and cancelling a Module's simplified version. */
export interface SimpleApi {
  load(source: PlainSource, path: string): Promise<PlainSimpleAnswer>;
  start(source: PlainSource, path: string): Promise<void>;
  cancel(source: PlainSource, path: string): Promise<void>;
}

/** PLAIN-14.8: from this main pane width (rem), the simplified version sits beside the spec; below it, in place (PLAIN-14.15). */
export const SIDE_MIN_REM = 64;
/** PLAIN-14.6: how far a numbered clause's text sits in from its list's edge, its number in that room (rem). */
const NUM_INDENT_REM = 2.25;

/** PLAIN-14.10: each history entry's choice to show or hide the simplified version, kept as its view is. */
const sideByEntry = new Map<string, boolean>();
const entrySide = (): boolean | null => {
  const id = (window.history.state as { lookoutEntry?: string } | null)?.lookoutEntry;
  return id ? (sideByEntry.get(id) ?? null) : null;
};

/** What Module needs to show the simplified version (PLAIN-14). */
interface SimpleUi {
  answer: PlainSimpleAnswer | null;
  /** Why the last press was refused. */
  pressError: string | null;
  pressing: boolean;
  onSimplify(): void;
  onCancel(): void;
  /** PLAIN-14.10: it's shown. */
  side: boolean;
  /** PLAIN-14.8: the main pane is 64rem or wider, so it sits beside the spec; else it swaps in place (PLAIN-14.15). */
  wide: boolean;
  /** PLAIN-14.8: where "On this page" goes as a menu, in the header. */
  navSlot: HTMLElement | null;
  /** PLAIN-14.15: the specs whose text is shown under their simplified block. */
  shownText: ReadonlySet<string>;
  onShowText(spec: string, shown: boolean): void;
  /** The view's scroll box, which a block taller than it doesn't stick in (PLAIN-14.8). */
  box: RefObject<HTMLDivElement | null>;
}

/** PLAIN-11.1, 11.13: reading, starting and cancelling a Module's examples. */
export interface ExamplesApi {
  load(source: PlainSource, path: string): Promise<PlainExamplesAnswer>;
  start(source: PlainSource, path: string): Promise<void>;
  cancel(): Promise<void>;
}

/** PLAIN-11.13: while this Module's examples are made, they're read this often. */
export const EXAMPLES_RUNNING_POLL_MS = 1500;

/** PLAIN-11.10: a kept frame's address. */
const frameUrl = (key: string, name: string) => `/api/plain/examples/frame?${new URLSearchParams({ key, name })}`;

/** What Module needs to show the examples (PLAIN-11) and the port check (PLAIN-12). */
interface ExamplesUi {
  answer: PlainExamplesAnswer | null;
  /** Why the last press was refused; cleared when a run ends. */
  pressError: string | null;
  /** A press is on its way: the wait shows at once, before any read says the run started. */
  pressing: boolean;
  /** PLAIN-11.15: the PR's number, when the Module is a PR's: its tests run in a worktree of its head. */
  pr: number | null;
  onShow(): void;
  onCancel(): void;
}

const SECTION_TITLES: Record<string, string> = { definitions: 'Definitions', 'implementation reqs': 'Implementation requirements', 'test reqs': 'Test requirements' };
const NAV_TITLES: Record<string, string> = { definitions: 'Definitions', 'implementation reqs': 'Implementation reqs', 'test reqs': 'Test reqs' };
const sectionId = (key: string) => `plain-${key.replace(/[^a-z0-9]+/gi, '-')}`;
const specAnchor = specHash;
const defAnchor = (name: string) => `plain-def-${name.replace(/[^A-Za-z0-9]+/g, '-')}`;
const moduleName = (path: string) => path.replace(/^.*\//, '').replace(/\.plain$/, '');
const noop = () => {};
const isTextField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
/** Keys that scroll the view, which let go of a jump's hold (VIEW-1.11). */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** PLAIN-1.5: a Module new since the base compares with nothing, so every clause is added. */
const compare = (a: Pick<PlainAnswer, 'text' | 'baseText'>) => compareModules(a.text, a.baseText ?? (a.text !== null ? '' : null));

/** PLAIN-8.5: the description is a change too: rewritten, or added with a new Module, removed with a deleted one. */
const descriptionState = (answer: PlainAnswer, compared: Compared): Clause['state'] =>
  !compared.diffed ? 'same' : compared.oldDescription !== null ? 'changed' : !compared.module.description ? 'same' : answer.text === null ? 'removed' : answer.baseText === null ? 'added' : 'same';

/** PLAIN-10.2, 10.3: whether the Module has a change PLAIN-8.5 counts, which gives it the view switch. */
const hasAnyChange = (answer: PlainAnswer, compared: Compared) =>
  compared.diffed && (compared.stats.added + compared.stats.changed + compared.stats.removed > 0 || descriptionState(answer, compared) !== 'same');

/** PLAIN-10.6: scrolls to an anchor in the view; the Spec view's opens the fold that holds it first. */
const Reveal = createContext<(id: string) => void>((id) => document.getElementById(id)?.scrollIntoView?.({ block: 'start' }));

/** An anchor link's click: a plain click lands on its target in the view (PLAIN-10.6), a modified one is the browser's. */
function useJump() {
  const reveal = useContext(Reveal);
  return useCallback(
    (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      reveal(id);
    },
    [reveal],
  );
}

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
 * PLAIN-1 to 5: a Module of a live Session's Checkout or of a PR, whole, its change since the base
 * marked in place, other Modules' Concepts on hover, and its Viewed box.
 */
export function SpecView({ source, path, backTo, load, setViewed, onBack, onOpenModule, examples, simple }: SpecViewProps) {
  // The source by value: a new object for the same Checkout or PR never starts the reads over.
  const sourceKey = JSON.stringify(source);
  const src = useMemo(() => JSON.parse(sourceKey) as PlainSource, [sourceKey]);
  const [answer, setAnswer] = useState<PlainAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justChanged, setJustChanged] = useState<ReadonlySet<string>>(new Set());
  /** PLAIN-10.2: the view chosen here, or kept with this history entry; null until one is. */
  const [chosen, setChosen] = useState<SpecMode | null>(entryView);
  /** PLAIN-10.6: the folds of Changes opened while the view is open, by their key (`runKey`). */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const last = useRef<PlainAnswer | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** The view's scroll box, PlainView's, beside the rail of changes (PLAIN-8.5). */
  const box = useRef<HTMLDivElement>(null);
  /** PLAIN-8.6: the change last jumped to holds the place until you scroll yourself, as the chat's (VIEW-1.11). */
  const held = useRef<string | null>(null);
  const here = routePath(plainRoute(src, path));
  const hrefOf = useCallback((p: string) => routePath(plainRoute(src, p)), [src]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let clear: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const read = async () => {
      try {
        const fresh = first;
        first = false;
        const next = await load(src, path, fresh);
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
  }, [load, src, path]);

  const toggleViewed = useCallback(async () => {
    const a = last.current;
    if (!a || saving) return;
    const next = !a.viewed;
    setSaving(true);
    try {
      await setViewed(src, path, a.key, next);
      // Only the answer it was saved for takes it: a read that brought a newer text meanwhile stands.
      const apply = (x: PlainAnswer | null) => (x && x.key === a.key ? { ...x, viewed: next, changedSinceViewed: next ? false : x.changedSinceViewed } : x);
      last.current = apply(last.current);
      setAnswer(apply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [saving, setViewed, src, path]);

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
  const hasChange = !!answer && !!compared && hasAnyChange(answer, compared);

  // PLAIN-11.2: the changed functional specs, which examples are made for.
  const hasGroups = !!compared && compared.module.specs.some((s) => s.state === 'added' || s.state === 'changed');
  const [ex, setEx] = useState<PlainExamplesAnswer | null>(null);
  const [pressError, setPressError] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const [exRead, setExRead] = useState(0);
  const exRunning = useRef(false);
  const anyRunning = useRef(false);
  useEffect(() => {
    if (!examples || !hasGroups) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      try {
        const next = await examples.load(src, path);
        if (!alive) return;
        exRunning.current = !!next.running?.mine;
        // A refusal is about the run it met: once that run ends, the answer says the rest.
        if (anyRunning.current && !next.running) setPressError(null);
        anyRunning.current = !!next.running;
        setEx((e) => (e && JSON.stringify(e) === JSON.stringify(next) ? e : next));
      } catch {
        // The Module's own read says what's wrong with it.
      }
      if (alive) timer = setTimeout(() => void read(), exRunning.current ? EXAMPLES_RUNNING_POLL_MS : SPEC_POLL_MS);
    };
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [examples, hasGroups, src, path, exRead]);
  const showExamples = useCallback(async () => {
    if (!examples) return;
    setPressError(null);
    setPressing(true);
    try {
      await examples.start(src, path);
    } catch (err) {
      setPressError(err instanceof Error ? err.message : String(err));
    } finally {
      setPressing(false);
    }
    setExRead((n) => n + 1);
  }, [examples, src, path]);
  const cancelExamples = useCallback(async () => {
    try {
      await examples?.cancel();
    } catch {
      // The next read says how it ended.
    }
    setExRead((n) => n + 1);
  }, [examples]);
  const exUi = useMemo<ExamplesUi | undefined>(
    () =>
      examples && hasGroups
        ? { answer: ex, pressError, pressing, pr: src.kind === 'pr' ? src.number : null, onShow: () => void showExamples(), onCancel: () => void cancelExamples() }
        : undefined,
    [examples, hasGroups, ex, pressError, pressing, src, showExamples, cancelExamples],
  );
  // PLAIN-14: the simplified version, read as the examples are, more often while it's written.
  const [sp, setSp] = useState<PlainSimpleAnswer | null>(null);
  const [spPressError, setSpPressError] = useState<string | null>(null);
  const [spPressing, setSpPressing] = useState(false);
  const [spRead, setSpRead] = useState(0);
  const spRunning = useRef(false);
  /** PLAIN-14.10: a press whose run hasn't been seen to end; when it ends with a version, it shows. */
  const spAwaiting = useRef(false);
  /** PLAIN-14.10: shown or hidden, chosen here or kept with this history entry; null until chosen. */
  const [sideChosen, setSideChosen] = useState<boolean | null>(entrySide);
  // PLAIN-14.12: a read that sees the spec text change reads the version again at once. Till it lands, and
  // when it fails, a block whose own spec changed since the last read hides, as that read will say.
  const spText = answer ? `${answer.text ?? ''}\u0000${answer.baseText ?? ''}` : null;
  const answerNow = useRef(answer);
  useLayoutEffect(() => {
    answerNow.current = answer;
  });
  /** The Module as this view read it when the version was last read. */
  const [spAt, setSpAt] = useState<PlainAnswer | null>(null);
  useEffect(() => {
    if (!simple || !hasGroups) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The text this effect reads for: a change of it starts another.
    const at = answerNow.current;
    const read = async () => {
      try {
        const next = await simple.load(src, path);
        if (!alive) return;
        setSpAt(at);
        spRunning.current = !!next.running;
        if (spAwaiting.current && !next.running) {
          spAwaiting.current = false;
          if (next.simple && !next.error) setSideChosen(true);
        }
        setSp((x) => (x && JSON.stringify(x) === JSON.stringify(next) ? x : next));
      } catch {
        // The Module's own read says what's wrong with it; the blocks whose specs changed since hide (sinceRead).
      }
      if (alive) timer = setTimeout(() => void read(), spRunning.current ? EXAMPLES_RUNNING_POLL_MS : SPEC_POLL_MS);
    };
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [simple, hasGroups, src, path, spRead, spText]);
  /** PLAIN-14.13: counts presses and Cancels, so a press cancelled before it started doesn't open the side. */
  const spPress = useRef(0);
  const simplify = useCallback(async () => {
    if (!simple) return;
    const press = ++spPress.current;
    setSpPressError(null);
    setSpPressing(true);
    try {
      await simple.start(src, path);
      if (spPress.current === press) spAwaiting.current = true;
    } catch (err) {
      setSpPressError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpPressing(false);
    }
    setSpRead((n) => n + 1);
  }, [simple, src, path]);
  const cancelSimplify = useCallback(async () => {
    try {
      await simple?.cancel(src, path);
      spPress.current++;
      spAwaiting.current = false;
    } catch (err) {
      // PLAIN-14.13: a Cancel too late to stop the save says so; the next read shows the version it saved.
      setSpPressError(err instanceof Error ? err.message : String(err));
    }
    setSpRead((n) => n + 1);
  }, [simple, src, path]);
  const specKeys = useMemo(() => specTexts(compared), [compared]);
  const spKeys = useMemo(() => (!spAt ? null : spAt === answer ? specKeys : specTexts(compare(spAt))), [spAt, answer, specKeys]);
  const spShown = useMemo(() => sinceRead(sp, spKeys, specKeys), [sp, spKeys, specKeys]);
  const spKept = spShown?.simple ?? null;
  const hasSimple = !!spKept && (spKept.blocks.length > 0 || !!spKept.lead);
  /** PLAIN-14.8: whether the main pane has room for the two columns; without a ResizeObserver, it does. */
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // A read of the root's size, so 64rem follows a browser's own text size.
      const rem = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('font-size')) || 16;
      setWide(el.clientWidth >= SIDE_MIN_REM * rem);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [shownText, setShownText] = useState<ReadonlySet<string>>(() => new Set());
  const onShowText = useCallback((spec: string, shown: boolean) => {
    setShownText((x) => {
      const n = new Set(x);
      if (shown) n.add(spec);
      else n.delete(spec);
      return n;
    });
  }, []);
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);

  // PLAIN-10.3: a Module with no change is Clean, with no switch; a change arriving later keeps you on Clean.
  if (answer && compared && !hasChange && chosen !== 'clean') setChosen('clean');
  const deleted = answer?.text === null;
  // PLAIN-10.2: a Module with a change opens on Changes; a deleted one can't be Clean (PLAIN-10.3).
  const view: SpecMode = !hasChange ? 'clean' : chosen === null || (deleted && chosen === 'clean') ? 'changes' : chosen;
  const highlight = view !== 'clean';
  useEffect(() => {
    if (answer) viewByEntry.set(entryId(), view);
  }, [answer, view]);
  // PLAIN-14.10: a Module with a simplified version opens with it shown; Clean has none.
  const side = hasSimple && view !== 'clean' && (sideChosen ?? true);
  useEffect(() => {
    if (answer && sideChosen !== null) sideByEntry.set(entryId(), sideChosen);
  }, [answer, sideChosen]);
  const simpleUi = useMemo<SimpleUi | undefined>(
    () =>
      simple && hasGroups
        ? { answer: spShown, pressError: spPressError, pressing: spPressing, onSimplify: () => void simplify(), onCancel: () => void cancelSimplify(), side, wide, navSlot, shownText, onShowText, box }
        : undefined,
    [simple, hasGroups, spShown, spPressError, spPressing, simplify, cancelSimplify, side, wide, navSlot, shownText, onShowText],
  );


  /** PLAIN-10.6: a link's target that is folded is shown first, then landed on. */
  const landing = useRef<string | null>(null);
  /** PLAIN-10.6: the fold just opened by hand, whose first item takes focus. */
  const focusing = useRef<string | null>(null);

  // PLAIN-2.5: the position is kept as you scroll and put back once the Module is first shown.
  const restored = useRef(false);
  useEffect(() => {
    const box = scroller.current?.parentElement;
    if (!box || !answer) return;
    let entry = entryId();
    if (!restored.current) {
      restored.current = true;
      const at = scrollByEntry.get(entry);
      // An entry scrolled back to the top keeps the top, not the spec it was opened at.
      if (at !== undefined) box.scrollTop = at;
      else if (window.location.hash.startsWith('#plain-s-')) {
        // PLAIN-7.2: opened at a spec, which lands below the strip as a jump does (PLAIN-9.3). A spec's
        // anchor is letters, digits and `-` only (`specHash`), so the hash needs no decoding.
        const target = document.getElementById(window.location.hash.slice(1));
        if (target) box.scrollTop = belowStrip(box, target);
        else {
          // PLAIN-10.6: a spec Changes folds is shown first, then landed on.
          const fold = scroller.current?.querySelector<HTMLElement>(`[data-holds~="${window.location.hash.slice(1)}"]`)?.dataset.fold;
          if (fold) {
            landing.current = window.location.hash.slice(1);
            setOpened((o) => new Set(o).add(fold));
          }
        }
      }
    }
    const onScroll = () => scrollByEntry.set(entry, box.scrollTop);
    // Back or Forward between two entries of the same Module keeps this view: it moves to the
    // position of the entry it lands on.
    const onPop = () => {
      const next = entryId();
      if (next === entry) return;
      entry = next;
      held.current = null;
      // PLAIN-10.2: in the view that entry was left in, drawn before its position is put back.
      flushSync(() => {
        setChosen(viewByEntry.get(next) ?? null);
        setSideChosen(sideByEntry.get(next) ?? null);
      });
      box.scrollTop = scrollByEntry.get(next) ?? 0;
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPop);
    return () => {
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPop);
    };
  }, [answer, here]);

  const reveal = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) return void el.scrollIntoView?.({ block: 'start' });
    // A spec's closed Notes (PLAIN-9.5) open at once, so what's in them is there to scroll to and focus.
    const notes = scroller.current?.querySelector<HTMLElement>(`[data-notes-holds~="${id}"]`);
    if (notes) {
      notes.dispatchEvent(new Event(OPEN_NOTES));
      const inside = document.getElementById(id);
      if (inside) return void inside.scrollIntoView?.({ block: 'start' });
    }
    const fold = scroller.current?.querySelector<HTMLElement>(`[data-holds~="${id}"]`)?.dataset.fold;
    if (!fold) return;
    landing.current = id;
    setOpened((o) => new Set(o).add(fold));
  }, []);
  const onUnfold = useCallback((key: string) => {
    focusing.current = key;
    setOpened((o) => new Set(o).add(key));
  }, []);
  useLayoutEffect(() => {
    const key = focusing.current;
    focusing.current = null;
    const shown = key ? scroller.current?.querySelector<HTMLElement>(`[data-run="${key}"]`) : null;
    if (shown) {
      shown.tabIndex = -1;
      shown.focus({ preventScroll: true });
    }
    // One try: a target the opened run doesn't hold is dropped, so a later fold never lands on it.
    const id = landing.current;
    landing.current = null;
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [opened]);
  const name = moduleName(path);

  // PLAIN-8.5: every change rendered is a Mark, in the order it is shown; read from the page after
  // each render, so the Marks are always the changes on screen (none in Clean, PLAIN-10.4).
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const marksRef = useRef(marks);
  /** PLAIN-9.5: bumped when a spec's notes open or close, which adds or removes changes on screen. */
  const [folds, setFolds] = useState(0);
  const onFold = useCallback(() => setFolds((n) => n + 1), []);
  useLayoutEffect(() => {
    // A node React kept from an earlier render may still carry its old cursor: every one is cleared first.
    for (const el of scroller.current?.querySelectorAll<HTMLElement>('[data-mark]') ?? []) delete el.dataset.mark;
    const els = highlight && scroller.current ? [...scroller.current.querySelectorAll<HTMLElement>('[data-change]')] : [];
    const next = els.map((el, i): Mark => {
      el.dataset.mark = `c${i}`;
      return { cursor: `c${i}`, kind: el.dataset.change as ChangeKind, text: firstLine(gist(el.dataset.changeText ?? '') || (el.textContent ?? '')), ts: null, where: el.closest<HTMLElement>('[data-where]')?.dataset.where };
    });
    const prev = marksRef.current;
    if (prev.length === next.length && prev.every((m, i) => m.kind === next[i]!.kind && m.text === next[i]!.text && m.where === next[i]!.where)) return;
    // The cursors now name other changes: a hold on one would step from the wrong place.
    held.current = null;
    marksRef.current = next;
    setMarks(next);
  }, [highlight, view, answer, compared, folds, opened, side, wide, shownText]);

  const [jumped, setJumped] = useState<{ cursor: string } | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [active, setActive] = useState<string | null>(null);
  /** PLAIN-9.3: the spec the view's top edge is inside, once its heading has scrolled away. */
  const [stuck, setStuck] = useState<string | null>(null);
  useLayoutEffect(() => {
    marksRef.current = marks;
  });
  /** Where each change sits in the scrolled content, in the Marks' order. */
  const changeTops = useCallback(() => {
    const el = box.current;
    if (!el) return [];
    const base = el.getBoundingClientRect().top - el.scrollTop;
    return marksRef.current.map((m) => {
      const at = scroller.current?.querySelector<HTMLElement>(`[data-mark="${m.cursor}"]`);
      // PLAIN-14.15: a change in a spec whose text is hidden under its simplified block sits where its spec does.
      const shown = at?.closest('[data-spec-text="hidden"]') ? at.closest('[data-spec-id]') : at;
      return (shown?.getBoundingClientRect().top ?? 0) - base;
    });
  }, []);
  /** PLAIN-8.2, 8.6: the outline's current entry and the change you're at, from the scroll position. */
  const place = useCallback(() => {
    const el = box.current;
    if (!el || !scroller.current) return;
    // PLAIN-9.3: what lands below the strip (a jump, an outline link, focus) counts as where you are.
    const top = el.getBoundingClientRect().top + JUMP_MARGIN_PX + STRIP_PX + 1;
    let current: string | null = null;
    for (const a of scroller.current.querySelectorAll<HTMLElement>('[data-outline]')) {
      if (a.getBoundingClientRect().top <= top) current = a.id;
      else break;
    }
    setActive(current);
    const boxTop = el.getBoundingClientRect().top;
    let inside: string | null = null;
    for (const s of scroller.current.querySelectorAll<HTMLElement>('[data-spec-id]')) {
      const r = s.getBoundingClientRect();
      if (r.top > boxTop) break;
      const head = s.querySelector('[data-spec-head]')?.getBoundingClientRect();
      if (head && head.bottom <= boxTop && r.bottom > boxTop + STRIP_PX) inside = s.dataset.specId ?? null;
    }
    setStuck(inside);
    const ms = marksRef.current;
    const heldAt = held.current ? ms.findIndex((m) => m.cursor === held.current) : -1;
    if (heldAt >= 0) return setAt(heldAt);
    const line = el.scrollTop + JUMP_MARGIN_PX + STRIP_PX + 1;
    let passed: number | null = null;
    changeTops().forEach((t, i) => {
      if (t <= line) passed = i;
    });
    setAt(passed);
  }, [changeTops]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    // Scrolling yourself lets go of the change last jumped to (VIEW-1.11's hold).
    const release = () => {
      held.current = null;
    };
    // A key that scrolls the view, from inside it or the page; not Space or Enter pressing a button.
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      const t = e.target;
      if (!(t instanceof Node) || (t !== document.body && !el.contains(t)) || isTextField(t)) return;
      if (e.key === ' ' && t instanceof Element && t.closest('button, summary, [role="button"], [role="checkbox"]')) return;
      release();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target === el) release();
    };
    // The outline, the Changes card and § links move the view themselves.
    const onClick = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('a[href^="#"]')) release();
    };
    // So does a card's "Go to §N.M" (PLAIN-7.1), from its popover outside the view.
    const onCardClick = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('[data-slot="concept-card"] a[href^="#"]')) release();
    };
    el.addEventListener('click', onClick, true);
    document.addEventListener('click', onCardClick, true);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', release, { passive: true });
    el.addEventListener('touchmove', release, { passive: true });
    el.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    place();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', release);
      el.removeEventListener('touchmove', release);
      el.removeEventListener('pointerdown', onPointer);
      el.removeEventListener('click', onClick, true);
      document.removeEventListener('click', onCardClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [place, answer]);
  useEffect(() => place(), [place, marks]);

  /** PLAIN-8.5, 8.6: scroll a change to just below the top edge; from the rail, focus moves to it. */
  const jumpTo = useCallback(
    (cursor: string, focus: boolean) => {
      const el = box.current;
      const target = scroller.current?.querySelector<HTMLElement>(`[data-mark="${cursor}"]`);
      if (!el || !target) return;
      // PLAIN-14.15: a change inside a spec text hidden under its simplified block shows that text first.
      const hidden = target.closest<HTMLElement>('[data-spec-text="hidden"]')?.dataset.spec;
      if (hidden) flushSync(() => onShowText(hidden, true));
      held.current = cursor;
      setJumped({ cursor });
      setAt(marksRef.current.findIndex((m) => m.cursor === cursor));
      const top = belowStrip(el, target);
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
      else el.scrollTop = top;
      if (focus) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    },
    [onShowText],
  );
  const step = useCallback(
    (dir: 1 | -1) => {
      const el = box.current;
      const ms = marksRef.current;
      if (!el || ms.length === 0) return;
      const from = held.current ? ms.findIndex((m) => m.cursor === held.current) : -1;
      // PLAIN-9.3: changes land below the strip, so the line they're measured from is lower by its height.
      const next = stepMark(changeTops(), el.scrollTop + STRIP_PX, dir, from >= 0 ? from : null);
      if (next !== null) jumpTo(ms[next]!.cursor, false);
    },
    [changeTops, jumpTo],
  );
  // PLAIN-8.6: `[` and `]`, as in the chat: not in a text field or a dialog; Option or AltGr is allowed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || (e.key !== '[' && e.key !== ']')) return;
      if (e.metaKey || (e.ctrlKey && !e.altKey)) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      // Not while a dialog is open, the Concept card (PLAIN-2.2) included, wherever focus is.
      if ((t instanceof Element && t.closest('[role="dialog"]')) || document.querySelector('[role="dialog"][aria-modal="true"], [data-slot="concept-card"]')) return;
      e.preventDefault();
      step(e.key === ']' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // PLAIN-8.6, 10.7: in a narrow header Back is its arrow and Viewed its box, and the name gives way
  // first; the switch keeps its words and the stepper its count.
  const header = (
    <div className="@container/header flex min-w-0 flex-1 items-center gap-3">
      <Button type="button" variant="secondary" size="default" className="shrink-0 font-normal" onClick={onBack} data-field="spec-back" title={backTo ? `Back to ${backTo}` : 'Back'}>
        <ArrowLeft aria-hidden />
        <span className="max-w-48 truncate @max-[40rem]/header:sr-only">{backTo ? `Back to ${backTo}` : 'Back'}</span>
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-title font-semibold tracking-tight">
        {name}
        <span className="font-normal text-muted-foreground">.plain</span>
      </h1>
      {/* PLAIN-14.8: beside the simplified version, "On this page" is a menu here. */}
      {side && wide && <div ref={setNavSlot} className="shrink-0" data-slot="spec-nav-slot" />}
      {highlight && marks.length > 0 && (
        <div className="flex shrink-0 items-center gap-0.5 text-meta" data-field="spec-stepper">
          <IconButton label="Previous change" shortcut="[" onClick={() => step(-1)}>
            <ChevronUp aria-hidden />
          </IconButton>
          <span className="min-w-16 text-center tabular-nums" data-field="spec-at">
            {at === null ? `${marks.length} ${marks.length === 1 ? 'change' : 'changes'}` : `${at + 1} of ${marks.length}`}
          </span>
          <IconButton label="Next change" shortcut="]" onClick={() => step(1)}>
            <ChevronDown aria-hidden />
          </IconButton>
        </div>
      )}
      {hasChange && <Segmented label="View" choices={deleted ? DELETED_CHOICES : VIEW_CHOICES} value={view} onChange={(v) => setChosen(v)} />}
      {/* PLAIN-14.10: once there's a simplified version, a toggle shows or hides it; Clean has none. */}
      {hasSimple && view !== 'clean' && (
        <Button
          type="button"
          variant={side ? 'soft' : 'secondary'}
          size="default"
          className="shrink-0"
          aria-pressed={side}
          onClick={() => setSideChosen(!side)}
          title={side ? 'Hide the simplified version' : 'Show the simplified version beside the spec'}
          data-field="spec-simple-toggle"
        >
          <Columns2 aria-hidden />
          <span className="@max-[40rem]/header:sr-only">Simplified</span>
        </Button>
      )}
      {/* PLAIN-10.1: Viewed is last, a mark of its own after a divider (DS-18.5's, 4 px either side of a 12 px gap). */}
      {hasChange && <ButtonDivider className="-mx-2" />}
      <label className={cn('flex shrink-0 items-center gap-1.5 text-meta', !answer && 'opacity-50')} title="Viewed (V)">
        <Checkbox checked={!!answer?.viewed} disabled={!answer || saving} onChange={() => void toggleViewed()} aria-keyshortcuts="V" data-field="spec-viewed" />
        <span className="@max-[40rem]/header:sr-only">Viewed</span>
      </label>
    </div>
  );

  return (
    <PlainView
      aria-label={`Spec ${name}`}
      header={header}
      data-view="spec"
      scrollRef={box}
      // PLAIN-9.3: scrolling a link's target or a focused element into view keeps the strip's room clear.
      scrollClassName="scroll-pt-9"
      rail={<ChatRail label="Changes" scrollRef={box} listRef={scroller} marks={marks} version={marks} jumped={jumped} canLoadEarlier={false} loadingEarlier={false} onEarlier={noop} onJump={jumpTo} />}
    >
      <div ref={scroller} className="@container px-5 py-4">
        {error && <Alert className="mb-3" title={error} />}
        {!answer && !error && <Loading label={`Reading ${name}.plain…`} />}
        {answer && compared && (
          <Reveal.Provider value={reveal}>
            <Module
              answer={answer}
              compared={compared}
              hasChange={hasChange}
              justChanged={justChanged}
              view={view}
              opened={opened}
              onUnfold={onUnfold}
              active={active}
              stuck={stuck}
              onFold={onFold}
              onOpenModule={onOpenModule}
              hrefOf={hrefOf}
              examples={exUi}
              simple={simpleUi}
            />
          </Reveal.Provider>
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
  /** False in Clean (PLAIN-10.4): no marks, and what was removed isn't there. */
  highlight: boolean;
  /** PLAIN-10.5: in Changes, what didn't change folds into a line; absent in Whole, Clean, a card and an opened run. */
  fold?: { opened: ReadonlySet<string>; onUnfold(key: string): void };
  onTerm(name: string, el: HTMLElement, how: 'enter' | 'leave' | 'focus' | 'blur', kind?: CardKind): void;
  /** PLAIN-7.1: this Module's specs by id, for a `§`'s card; absent inside a card. */
  specById?: ReadonlyMap<string, FunctionalSpec>;
  /** PLAIN-7.2: another Module's link, and opening it at a spec; absent inside a card. */
  hrefOf?(path: string): string;
  onOpenModule?(path: string, at?: string): void;
  /** PLAIN-9.5: a spec's notes opened or closed, so the Marks are read again. */
  onFold?(): void;
  /** PLAIN-11.9: the Module's kept examples, by spec id. */
  examples?: { kept: NonNullable<PlainExamplesAnswer['examples']>; of: ReadonlyMap<string, PlainExample> };
  /** PLAIN-14: the simplified version, while it's shown; absent otherwise. */
  side?: SideCtx;
  /** PLAIN-14.6: the spec's clauses, tests and notes by their numbers, inside a spec while the side is shown. */
  numbers?: ReadonlyMap<Clause, string>;
  /** The spec a list is in, for its clauses' anchors and what they light (PLAIN-14.7). */
  specId?: string;
  /** PLAIN-14.9: present while the Module has a simplified version, the side shown or not. */
  light?: Light;
}

/** PLAIN-14.7, 14.9: what the pointer or focus is on: a paragraph (its index), a clause (its number), a block's left-out clauses, or a spec's heading. */
type Lit = { spec: string; kind: 'paragraph' | 'clause' | 'gap' | 'head'; key: string };

/** PLAIN-14.7, 14.9: what's lit, and lighting it; In short's citations light a heading with the side hidden too. */
interface Light {
  lit: { spec: string; clauses: ReadonlySet<string>; paragraphs: ReadonlySet<number>; head: boolean } | null;
  /** Lights `l` over what's lit, till it's put out. */
  setLit(l: Lit): void;
  /** Puts out `l`, wherever it is among the lights held: what another hover or focus still holds shows again. */
  unlit(l: Lit): void;
}

interface SideCtx {
  /** PLAIN-14.8: two columns; else the block swaps in place (PLAIN-14.15). */
  wide: boolean;
  kept: PlainSimple;
  blocks: ReadonlyMap<string, PlainSimpleBlock>;
  /** The spec lit, and its lit clauses and paragraphs. */
  lit: Light['lit'];
  setLit: Light['setLit'];
  unlit: Light['unlit'];
  shownText: ReadonlySet<string>;
  onShowText(spec: string, shown: boolean): void;
  onSimplify(): void;
  /** This Module's run is going, so Simplify again waits. */
  busy: boolean;
  box: RefObject<HTMLDivElement | null>;
}

function Module({
  answer,
  compared,
  hasChange,
  justChanged,
  view,
  opened,
  onUnfold,
  active,
  stuck,
  onFold,
  onOpenModule,
  hrefOf,
  examples,
  simple,
}: {
  answer: PlainAnswer;
  compared: Compared;
  /** PLAIN-10.2: a change PLAIN-8.5 counts. */
  hasChange: boolean;
  justChanged: ReadonlySet<string>;
  view: SpecMode;
  /** PLAIN-10.6: the folds opened, and opening one by hand. */
  opened: ReadonlySet<string>;
  onUnfold(key: string): void;
  /** PLAIN-8.2: the id of the section or spec at the top of the view. */
  active: string | null;
  /** PLAIN-9.3: the id of the spec the strip names, or null. */
  stuck: string | null;
  /** PLAIN-9.5: a spec's notes opened or closed. */
  onFold(): void;
  onOpenModule(path: string, at?: string): void;
  hrefOf(path: string): string;
  /** PLAIN-11, 12: absent where examples aren't offered or nothing changed. */
  examples?: ExamplesUi;
  /** PLAIN-14: absent where it isn't offered or nothing changed. */
  simple?: SimpleUi;
}) {
  const mod = compared.module;
  const [allSpecs, setAllSpecs] = useState(false);
  const own = useMemo(() => new Set((mod.sections.definitions ?? []).flatMap((n) => (definitionName(n.text) ? [definitionName(n.text)!.name] : []))), [mod]);
  const specIds = useMemo(() => new Set(mod.specs.map((s) => s.id)), [mod]);
  const specById = useMemo(() => new Map(mod.specs.map((s) => [s.id, s])), [mod]);
  const [card, setCard] = useState<Card | null>(null);
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
  const onTerm: Ctx['onTerm'] = (name, el, how, kind = 'concept') => {
    if (how === 'enter' || how === 'focus') {
      cancelClose();
      setCard({ kind, name, el });
    } else closeSoon();
  };
  const highlight = view !== 'clean';
  const fold = useMemo(() => (view === 'changes' ? { opened, onUnfold } : undefined), [view, opened, onUnfold]);
  const kept = examples?.answer?.examples ?? null;
  const exampleOf = useMemo(() => (kept ? new Map(kept.groups.map((g) => [g.spec, g])) : null), [kept]);
  // PLAIN-14: the simplified version, beside the spec in a wide pane or in place of it in a narrow one.
  const sk = simple?.answer?.simple ?? null;
  const sideOn = !!simple?.side && !!sk && highlight;
  const wideSide = sideOn && simple!.wide;
  const narrowSide = sideOn && !simple!.wide;
  const blocks = useMemo(() => new Map((sk?.blocks ?? []).map((b) => [b.spec, b])), [sk]);
  // PLAIN-14.7: the lights hovers and focus hold, the latest last. It shows; when it ends, the one before shows
  // again. Show them's light holds only till another lights.
  const [lights, setLights] = useState<readonly Lit[]>([]);
  const lit = useMemo(() => litSets(lights.at(-1) ?? null, blocks), [lights, blocks]);
  const setLit = useCallback((l: Lit) => setLights((xs) => (xs.length && sameLit(xs.at(-1)!, l) ? xs : [...xs.filter((x) => !sameLit(x, l) && x.kind !== 'gap'), l])), []);
  const unlit = useCallback((l: Lit) => setLights((xs) => (xs.some((x) => sameLit(x, l)) ? xs.filter((x) => !sameLit(x, l)) : xs)), []);
  const light = useMemo<Light | undefined>(() => (sk ? { lit, setLit, unlit } : undefined), [sk, lit, setLit, unlit]);
  const busy = !!simple?.answer?.running || !!simple?.pressing;
  const sideCtx = useMemo<SideCtx | undefined>(
    () => (sideOn && sk ? { wide: simple!.wide, kept: sk, blocks, lit, setLit, unlit, shownText: simple!.shownText, onShowText: simple!.onShowText, onSimplify: simple!.onSimplify, busy, box: simple!.box } : undefined),
    [sideOn, sk, simple, blocks, lit, setLit, unlit, busy],
  );
  /** PLAIN-14.15: in a narrow pane, a spec's simplified title stands for it in the card's rows and the outline. */
  const titleOf = (s: FunctionalSpec): string | null => {
    const b = narrowSide ? blocks.get(s.id) : undefined;
    return b && !b.stale && b.title ? b.title : null;
  };
  const ctx: Ctx = { own, specIds, specById, answer, justChanged, highlight, fold, onTerm, onFold, hrefOf, onOpenModule, examples: kept && exampleOf ? { kept, of: exampleOf } : undefined, side: sideCtx, light };
  /** PLAIN-14.8: one row of the two columns, or the content alone without them. */
  const row = (key: string, left: ReactNode, right?: ReactNode) =>
    wideSide ? (
      <SideRow key={key} right={right}>
        {left}
      </SideRow>
    ) : (
      <Fragment key={key}>{left}</Fragment>
    );
  const jump = useJump();
  const descState = descriptionState(answer, compared);
  const newOrGone = answer.text === null || answer.baseText === null;

  // PLAIN-10.4: Clean reads as a Module with no change: no card, nothing removed, nothing marked.
  const showCard = highlight && hasChange;
  const present = (n: Clause) => highlight || n.state !== 'removed';
  const live = mod.specs.filter((s) => s.state !== 'removed');
  const noted = (k: string) => (mod.sectionNotes[k] ?? []).some(present);
  const sectionKeys = [...new Set([...Object.keys(mod.sections), ...Object.keys(mod.sectionNotes)])].filter(
    (k) => k !== 'functional specs' && ((mod.sections[k] ?? []).some(present) || noted(k) || (highlight && compared.touchedSections.includes(k))),
  );
  const specs = highlight ? mod.specs : live;
  const hasSpecs = specs.length > 0 || noted('functional specs');
  const touched = new Set(highlight ? compared.touchedSections : []);

  // PLAIN-8.2: the changed specs, or every spec in a Module with none; "Show all" lists them all in
  // Whole. PLAIN-10.4, 10.5: Clean lists every spec, unmarked; Changes the changed ones, each shown.
  const specsChanged = highlight ? mod.specs.filter(specTouched) : [];
  const listAll = view === 'clean' || (view === 'whole' && (allSpecs || specsChanged.length === 0));
  const listed = listAll ? specs : specsChanged;
  const activeSpec = active && mod.specs.some((s) => specAnchor(s.id) === active) ? active : null;
  const current = activeSpec && !listed.some((s) => specAnchor(s.id) === activeSpec) ? sectionId('functional specs') : active;
  const nav = (
    <nav
      aria-label="On this page"
      data-slot="spec-nav"
      className={
        wideSide
          ? 'flex flex-col gap-0.5 text-meta'
          : 'flex shrink-0 flex-col gap-0.5 text-meta @min-[640px]:sticky @min-[640px]:top-0 @min-[640px]:col-start-3 @min-[640px]:row-start-1 @min-[640px]:max-h-[calc(100dvh-6rem)] @min-[640px]:self-start @min-[640px]:overflow-y-auto @min-[640px]:pl-8'
      }
    >
      <p aria-hidden className="mb-1 pl-2.5 text-caption font-medium text-muted-foreground">
        On this page
      </p>
      {showCard && <NavLink href="changes" label="Changes" current={current === 'changes'} />}
      {sectionKeys.map((k) => (
        <NavLink key={k} href={sectionId(k)} label={NAV_TITLES[k] ?? k} count={(mod.sections[k] ?? []).filter((n) => n.state !== 'removed').length} touched={touched.has(k)} current={current === sectionId(k)} />
      ))}
      {hasSpecs && <NavLink href={sectionId('functional specs')} label="Functional specs" count={live.length} touched={touched.has('functional specs')} current={current === sectionId('functional specs')} />}
      {listed.length > 0 && (
        <ol className="flex flex-col">
          {listed.map((s) => (
            <li key={s.id}>
              <a
                href={`#${specAnchor(s.id)}`}
                onClick={jump(specAnchor(s.id))}
                aria-current={current === specAnchor(s.id) ? 'location' : undefined}
                className={cn('flex min-w-0 items-baseline gap-1.5 border-l-2 py-1 pr-1.5 pl-4 hover:bg-accent', current === specAnchor(s.id) ? 'border-foreground' : 'border-border')}
                data-state={s.state}
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">{s.id}</span>
                <span className="line-clamp-2 min-w-0 flex-1" title={titleOf(s) ? specGist(s) : undefined}>
                  {titleOf(s) ?? (s.clauses[0] ? gist(s.clauses[0].text) : '')}
                </span>
                {highlight && <SpecMark spec={s} />}
              </a>
            </li>
          ))}
        </ol>
      )}
      {view === 'whole' && specsChanged.length > 0 && specsChanged.length < mod.specs.length && (
        <button type="button" className="mt-1 self-start pl-2.5 text-muted-foreground underline-offset-2 hover:underline" onClick={() => setAllSpecs((v) => !v)} data-field="spec-all">
          {allSpecs ? 'Show changed specs only' : `Show all ${mod.specs.length} specs`}
        </button>
      )}
    </nav>
  );

  const inShort = sk?.lead && sideOn ? <InShort lead={sk.lead} kept={sk} ctx={ctx} onSimplify={simple!.onSimplify} busy={busy} /> : null;
  // PLAIN-14.9: In short is at the top of the Changes card, or beside it with the two columns.
  const leadInCard = !!sk?.lead && !wideSide && !!simple && highlight;
  return (
    <div
      // PLAIN-8.1: the column is the chat's width, centred while the outline fits on its right; with less room it moves left, then narrows.
      // PLAIN-14.8: beside the simplified version, two columns with 3rem of margin either side of the pane.
      className={wideSide ? 'min-w-0 px-7' : 'flex min-w-0 flex-col gap-4 @min-[640px]:grid @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,48rem)_minmax(15rem,1fr)] @min-[640px]:items-start @min-[640px]:gap-0'}
      data-view={view}
      data-slot="spec-layout"
      data-side={wideSide ? 'beside' : narrowSide ? 'in-place' : undefined}
    >
      {wideSide ? simple!.navSlot && createPortal(<OutlineMenu>{nav}</OutlineMenu>, simple!.navSlot) : nav}
      {/* PLAIN-8.1: a long code span or word wraps, so nothing widens the pane. */}
      {/* PLAIN-9.1: at most 42rem, about 85 characters a line, from the column's left edge. */}
      <article
        className={cn('flex w-full min-w-0 flex-col [overflow-wrap:anywhere]', wideSide ? '' : 'max-w-[42rem] gap-5 @min-[640px]:col-start-2 @min-[640px]:row-start-1')}
        data-slot="spec-module"
      >
        <SpecStrip spec={stuck ? mod.specs.find((s) => s.id === stuck) : undefined} highlight={highlight} side={wideSide} />
        {row(
          'head',
          <header className="flex flex-col gap-1.5">
          <p className="text-meta text-muted-foreground" data-field="spec-where">
            {answer.path} · {answer.checkout.where ? `${answer.checkout.repo} · ${answer.checkout.where}` : answer.checkout.repo}
          </p>
          {(mod.description || compared.oldDescription) && (
            <p data-field="spec-description" data-where="Description" {...changeProps(descState, highlight, mod.description || (compared.oldDescription ?? ''))} className={cn('text-reading', changeProps(descState, highlight, '').className, descState === 'removed' && highlight && 'text-muted-foreground line-through')}>
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
          {answer.text === null && <Alert tone="info" title={`This Module was deleted since the ${answer.baseName}.`} detail={`Its text at the ${answer.baseName} is shown, every clause removed.`} />}
          {highlight && answer.baseText === null && answer.text !== null && compared.diffed && <p className="text-meta text-muted-foreground">New since the {answer.baseName}.</p>}
          {/* PLAIN-10.3: a text that differs only where nothing is marked opens on Clean, and says why. */}
          {!hasChange && answer.text !== null && answer.baseText !== null && answer.text !== answer.baseText && (
            <p className="text-meta text-muted-foreground" data-field="spec-text-only">
              Its text differs from the base, but no clause, note or definition does.
            </p>
          )}
          </header>,
          wideSide ? <SimpleHead kept={sk!} /> : null,
        )}
        {narrowSide && <SimpleHead kept={sk!} />}

        {answer.fetchError && row('fetch', <Alert tone="info" title={`Showing ${answer.checkout.where ?? 'the PR'} as fetched before`} detail={answer.fetchError} data-field="spec-fetch-error" />)}

        {answer.changedSinceViewed && !answer.viewed && row('since', <Alert tone="info" title="Changed since you viewed it" data-field="spec-changed-since" />)}

        {showCard &&
          row(
            'changes',
          <section id="changes" aria-label="Changes" className="flex flex-col gap-2 rounded-md border border-border p-3" data-slot="spec-changes" data-outline>
            {leadInCard && <InShort lead={sk!.lead!} kept={sk!} ctx={ctx} onSimplify={simple!.onSimplify} busy={busy} />}
            <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body font-semibold">
              Changes
              <span className="text-meta font-normal text-muted-foreground">against {answer.base} ({answer.baseName})</span>
              <span className="ml-auto flex gap-3 text-meta font-normal" data-field="spec-tally">
                <span className="text-diff-added-text">{compared.stats.added} added</span>
                <span className="text-muted-foreground">{compared.stats.changed} changed</span>
                <span className="text-diff-removed-text">{compared.stats.removed} removed</span>
              </span>
            </h2>
            {compared.stats.touched.length > 0 && (
              <ul className="flex flex-col text-meta">
                {touchedRows(compared.stats.touched, mod.specs).map((r) => (
                  <li key={r.where} className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto] items-baseline gap-2 border-t border-border py-1 first:border-t-0">
                    <a href={`#${touchedAnchor(r.where, specIds)}`} onClick={jump(touchedAnchor(r.where, specIds))} className="font-medium underline-offset-2 hover:underline">
                      {r.label}
                    </a>
                    <span className="truncate" title={r.spec && titleOf(r.spec) ? r.gist : undefined}>
                      {(r.spec && titleOf(r.spec)) || r.gist}
                    </span>
                    <span className="flex gap-1.5 tabular-nums">
                      {r.newSpec ? (
                        <span className="text-diff-added-text">new spec</span>
                      ) : r.removedSpec ? (
                        <span className="text-diff-removed-text">spec removed</span>
                      ) : (
                        <Counts added={r.added} changed={r.changed} removed={r.removed} />
                      )}
                      {r.parts && <span className="text-muted-foreground">· {r.parts}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(examples || simple) && <ChangesBar examples={examples} simple={simple} />}
          </section>,
            inShort,
          )}

        {mod.notes.length > 0 &&
          row(
            'module notes',
          <Folded ctx={ctx} keep={newOrGone} scope="module notes" items={mod.notes} label={plural(mod.notes.length, 'note on the Module', 'notes on the Module')}>
            {(run) => (
              <aside className="flex flex-col gap-1 border-l-2 border-border pl-3 text-prose text-muted-foreground" data-run={run}>
                {mod.notes.map((n, i) => (
                  <p key={i}>
                    <Inline text={n} ctx={ctx} />
                  </p>
                ))}
              </aside>
            )}
          </Folded>,
          )}

        {sectionKeys.map((k) =>
          row(
            k,
          <section key={k} id={sectionId(k)} aria-label={SECTION_TITLES[k] ?? k} className="flex flex-col gap-2" data-touched={touched.has(k) || undefined} data-outline data-where={SECTION_TITLES[k] ?? k}>
            <SectionTitle title={SECTION_TITLES[k] ?? k} count={(mod.sections[k] ?? []).filter((n) => n.state !== 'removed').length} />
            {k === 'definitions' ? <Definitions nodes={mod.sections[k] ?? []} ctx={ctx} /> : <ClauseList nodes={mod.sections[k] ?? []} ctx={ctx} inset={0} scope={k} />}
            {mod.sectionNotes[k] && <Notes nodes={mod.sectionNotes[k]} ctx={ctx} scope={`${k} notes`} />}
          </section>,
          ),
        )}

        {hasSpecs && (
          <section id={sectionId('functional specs')} aria-label="Functional specs" className={cn('flex flex-col', !wideSide && 'gap-3')} data-touched={touched.has('functional specs') || undefined} data-outline data-where="Functional specs">
            {row(
              'specs title',
              <>
                <SectionTitle title="Functional specs" count={live.length} />
                {mod.sectionNotes['functional specs'] && <Notes nodes={mod.sectionNotes['functional specs']} ctx={ctx} scope="functional specs notes" />}
              </>,
            )}
            <SpecList specs={specs} ctx={ctx} />
          </section>
        )}

        {mod.loose.length > 0 &&
          row(
            'loose',
          <section aria-label="Not in a section" className="flex flex-col gap-2" data-slot="spec-loose">
            <SectionTitle title="Not in a section" count={mod.loose.length} />
            <Folded ctx={ctx} keep={newOrGone} scope="loose" items={mod.loose} label={plural(mod.loose.length, 'line', 'lines')}>
              {(run) => (
                <pre className="whitespace-pre-wrap font-mono text-meta text-muted-foreground" data-run={run}>
                  {mod.loose.join('\n')}
                </pre>
              )}
            </Folded>
          </section>,
          )}

        {!sectionKeys.length && !hasSpecs && !mod.loose.length && <p className="text-meta text-muted-foreground">This Module is empty.</p>}
      </article>
      <ConceptCard card={card} answer={answer} specById={specById} onEnter={cancelClose} onLeave={closeSoon} onClose={() => setCard(null)} onOpenModule={onOpenModule} hrefOf={hrefOf} />
    </div>
  );
}

function NavLink({ href, label, count, touched, current }: { href: string; label: string; count?: number; touched?: boolean; current?: boolean }) {
  const jump = useJump();
  return (
    <a
      href={`#${href}`}
      onClick={jump(href)}
      aria-current={current ? 'location' : undefined}
      className={cn('flex items-center gap-1.5 border-l-2 px-2 py-1 hover:bg-accent', touched && 'font-medium', current ? 'border-foreground' : 'border-border')}
      data-touched={touched || undefined}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="tabular-nums text-muted-foreground">{count}</span>}
      {touched && <span aria-label="changed" className="text-muted-foreground">~</span>}
    </a>
  );
}

/** PLAIN-8.3: a bar at a changed clause's left edge, coloured by its change (`before:bg-…`). */
const BAR = "relative before:absolute before:top-1 before:bottom-1 before:-left-3 before:w-[3px] before:rounded-full before:content-['']";
const BAR_COLOUR: Partial<Record<Clause['state'], string>> = { added: 'before:bg-diff-added-text', removed: 'before:bg-diff-removed-text', changed: 'before:bg-muted-foreground' };

/**
 * PLAIN-8.3, 8.5: a changed clause's container: its bar, and the attributes that make it a Mark.
 * PLAIN-9.6: with `inset`, how far its list sits in from the Module's text edge (rem), a bulleted
 * clause's bar goes to the one gutter, GUTTER_REM left of that edge, whatever its depth.
 */
function changeProps(
  state: Clause['state'],
  highlight: boolean,
  text: string,
  bulleted = false,
  inset?: number,
  indent = INDENT_REM,
): { className?: string; style?: CSSProperties; 'data-change'?: string; 'data-change-text'?: string } {
  if (!highlight || state === 'same') return {};
  const gutter = bulleted && inset !== undefined;
  return {
    // A bulleted clause's bar sits left of its bullet.
    className: cn(BAR, BAR_COLOUR[state], bulleted && 'before:-left-6', gutter && 'before:left-(--bar-x)'),
    ...(gutter ? { style: { '--bar-x': `-${inset + indent + GUTTER_REM}rem` } as CSSProperties } : {}),
    'data-change': state,
    'data-change-text': text,
  };
}

/** A clause's, note's or spec's changes as `+2 ~1 −1`, the zeros left out. */
function Counts({ added = 0, changed = 0, removed = 0 }: { added?: number; changed?: number; removed?: number }) {
  return (
    <>
      {added > 0 && <span className="text-diff-added-text">+{added}</span>}
      {changed > 0 && <span className="text-muted-foreground">~{changed}</span>}
      {removed > 0 && <span className="text-diff-removed-text">−{removed}</span>}
    </>
  );
}

function countStates(nodes: readonly Clause[], into = { added: 0, changed: 0, removed: 0 }) {
  for (const n of nodes) {
    if (n.state !== 'same') into[n.state] += 1;
    countStates(n.children, into);
  }
  return into;
}

const specTouched = (s: FunctionalSpec) => s.state !== 'same' || hasChange(s.clauses) || hasChange(s.tests) || hasChange(s.notes);

/** PLAIN-8.2: a spec's mark in the outline: `+` new, `−` removed, `~` changed. */
function SpecMark({ spec }: { spec: FunctionalSpec }) {
  if (spec.state === 'added') return <span aria-label="new" className="shrink-0 text-diff-added-text">+</span>;
  if (spec.state === 'removed') return <span aria-label="removed" className="shrink-0 text-diff-removed-text">−</span>;
  if (specTouched(spec)) return <span aria-label="changed" className="shrink-0 text-muted-foreground">~</span>;
  return null;
}

/** PLAIN-8.4: the Changes card's rows, one per spec or section, its parts' counts summed. */
function touchedRows(touched: readonly Touched[], specs: readonly FunctionalSpec[]) {
  const rows = new Map<string, { where: string; label: string; spec: FunctionalSpec | undefined; gist: string; added: number; changed: number; removed: number; newSpec: boolean; removedSpec: boolean; tests: boolean; notes: boolean }>();
  for (const t of touched) {
    const where = t.where.replace(/ (tests|notes)$/, '');
    let r = rows.get(where);
    if (!r) {
      const spec = specs.find((s) => s.id === where);
      const label = spec ? where : where === 'description' ? 'Description' : (SECTION_TITLES[where] ?? (where === 'functional specs' ? 'Functional specs' : where));
      r = { where, label, spec, gist: spec?.clauses[0] ? gist(spec.clauses[0].text) : '', added: 0, changed: 0, removed: 0, newSpec: false, removedSpec: false, tests: false, notes: false };
      rows.set(where, r);
    }
    r.added += t.added ?? 0;
    r.changed += t.changed ?? 0;
    r.removed += t.removed ?? 0;
    r.newSpec ||= !!t.newSpec;
    r.removedSpec ||= !!t.removedSpec;
    if (t.where.endsWith(' tests')) r.tests = true;
    if (t.where.endsWith(' notes')) r.notes = true;
  }
  return [...rows.values()].map((r) => ({ ...r, parts: [r.tests && 'tests', r.notes && 'notes'].filter(Boolean).join(', ') }));
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 border-b border-border pb-1 text-body font-semibold">
      {title}
      <span className="text-meta font-normal tabular-nums text-muted-foreground">{count}</span>
    </h2>
  );
}

function touchedAnchor(where: string, specIds: ReadonlySet<string>): string {
  if (where === 'description') return 'changes';
  if (specIds.has(where)) return specAnchor(where);
  return sectionId(where);
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
    ctx.highlight && state === 'removed' && 'text-muted-foreground line-through',
    ctx.justChanged.has(text) && 'bg-muted',
  );
}

/** PLAIN-8.3: a clause's state, named to screen readers only: the bar shows it. */
function Tag({ state, ctx }: { state: Clause['state']; ctx: Ctx }) {
  if (!ctx.highlight || state === 'same') return null;
  return <span className="sr-only">{state} </span>;
}

/** PLAIN-1.8: a section's or a spec's `>` notes, quieter than its clauses, marked as clauses are; in Changes, the unchanged ones fold (PLAIN-10.5). */
function Notes({ nodes, ctx, scope = '' }: { nodes: readonly Clause[]; ctx: Ctx; scope?: string }) {
  const parts = foldRuns(nodes.filter((n) => there(n, ctx)), ctx.fold, scope, (n) => n.state !== 'same', (n) => n.text);
  if (!parts.length) return null;
  return (
    <div className="flex flex-col gap-1.5 text-prose text-muted-foreground" data-slot="spec-notes">
      {parts.map((part) => {
        if (part.kind === 'fold')
          return (
            <FoldLine
              key={`fold-${part.key}`}
              runKey={part.key}
              ctx={ctx}
              label={plural(part.items.length, 'unchanged note', 'unchanged notes')}
              holds={ctx.numbers && ctx.specId ? anchorsIn(part.items, ctx.numbers, ctx.specId) : undefined}
            />
          );
        const n = part.item;
        const num = ctx.numbers?.get(n);
        const change = changeProps(n.state, ctx.highlight, n.text);
        return (
          <p
            key={`${part.at}-${n.text.slice(0, 40)}`}
            id={num && ctx.specId ? clauseAnchor(ctx.specId, num) : undefined}
            data-state={n.state}
            data-just-changed={ctx.justChanged.has(n.text) || undefined}
            data-run={part.opens}
            {...change}
            className={cn(change.className, num && sideClass(ctx, num))}
            {...(num ? litHandlers(ctx, num) : {})}
          >
            {num && <span className="mr-2 font-mono text-meta tabular-nums text-spec-text" data-field="spec-clause-n">{num}</span>}
            <span className={stateClass(n.state, ctx, n.text)}>
              <Tag state={n.state} ctx={ctx} />
              <ClauseBody n={n} ctx={ctx} />
            </span>
          </p>
        );
      })}
    </div>
  );
}

const hasChange = (nodes: readonly Clause[]): boolean => nodes.some((n) => n.state !== 'same' || hasChange(n.children));

/** What's there in this view: in Clean (PLAIN-10.4), a removed clause isn't. */
const there = (n: Clause, ctx: Ctx) => ctx.highlight || n.state !== 'removed';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Inside an opened run, nothing folds again: it shows whole (PLAIN-10.6). */
const whole = (ctx: Ctx): Ctx => (ctx.fold ? { ...ctx, fold: undefined } : ctx);

/**
 * PLAIN-10.6: a fold's key: where it is and what it holds (its items' ids or texts), hashed, so a
 * read that keeps the run keeps it open and a read that changes it closes it.
 */
function runKey(scope: string, items: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of `${scope}\u0000${items.join('\u0001')}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${h.toString(36)}-${items.length}`;
}

type Part<T> = { kind: 'item'; item: T; at: number; whole: boolean; opens?: string } | { kind: 'fold'; items: T[]; key: string };

/**
 * PLAIN-10.5: in Changes, the items a list shows, each run of items with no change in it folded
 * into one part, or shown whole once opened (`opens` on its first item). Elsewhere, every item.
 */
function foldRuns<T>(items: readonly T[], fold: Ctx['fold'], scope: string, kept: (t: T) => boolean, id: (t: T) => string): Part<T>[] {
  if (!fold) return items.map((item, at) => ({ kind: 'item', item, at, whole: false }));
  const { opened } = fold;
  const out: Part<T>[] = [];
  let run: { item: T; at: number }[] = [];
  const flush = () => {
    if (!run.length) return;
    const key = runKey(scope, run.map((r) => id(r.item)));
    if (opened.has(key)) run.forEach((r, i) => out.push({ kind: 'item', ...r, whole: true, opens: i === 0 ? key : undefined }));
    else out.push({ kind: 'fold', items: run.map((r) => r.item), key });
    run = [];
  };
  items.forEach((item, at) => {
    if (!kept(item)) return void run.push({ item, at });
    flush();
    out.push({ kind: 'item', item, at, whole: false });
  });
  flush();
  return out;
}

/**
 * PLAIN-10.5, 10.6: a line in place of what Changes folds, saying what it holds; quiet, and never a
 * change. A click, Enter or Space shows the run there. `holds` names the anchors inside it, so a
 * link to one opens it first.
 */
function FoldLine({ runKey: key, ctx, label, holds, className }: { runKey: string; ctx: Ctx; label: string; holds?: readonly string[]; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => ctx.fold?.onUnfold(key)}
      data-slot="spec-fold"
      data-fold={key}
      data-holds={holds?.length ? holds.join(' ') : undefined}
      className={cn('-mx-1.5 flex items-center gap-1 self-start rounded px-1.5 py-0.5 text-left text-meta font-normal text-muted-foreground hover:bg-accent/60 hover:text-foreground', className)}
    >
      <ChevronRight aria-hidden className="size-3.5 shrink-0" />
      {label}
    </button>
  );
}

/**
 * PLAIN-10.5: something Changes folds whole (the Module's notes, its lines in no section), or shows
 * once opened. They aren't compared with the base, so in a new or deleted Module, all of whose text
 * is a change, they `keep` showing, and Changes shows what Whole does (PLAIN-10.3).
 */
function Folded({ ctx, keep, scope, items, label, children }: { ctx: Ctx; keep: boolean; scope: string; items: readonly string[]; label: string; children(run?: string): ReactNode }) {
  if (!ctx.fold || keep) return <>{children()}</>;
  const key = runKey(scope, items);
  return ctx.fold.opened.has(key) ? <>{children(key)}</> : <FoldLine runKey={key} ctx={ctx} label={label} />;
}

/**
 * A list of clauses, nested as the Module nests them. In the Module (`inset` given) it reads in
 * `reading` and its bars share one gutter (PLAIN-9.1, 9.6); in a Concept's card it stays `prose`.
 */
function ClauseList({
  nodes,
  ctx,
  className,
  inset,
  scope = '',
  noun = ['unchanged clause', 'unchanged clauses'],
}: {
  nodes: readonly Clause[];
  ctx: Ctx;
  className?: string;
  inset?: number;
  /** PLAIN-10.6: where the list is, for its folds' keys. */
  scope?: string;
  /** PLAIN-10.5: what its fold lines count. */
  noun?: readonly [string, string];
}) {
  // PLAIN-10.5: a changed clause shows with its unchanged parents; every other run folds.
  const parts = foldRuns(
    nodes.filter((n) => there(n, ctx)),
    ctx.fold,
    scope,
    (n) => n.state !== 'same' || hasChange(n.children),
    (n) => n.text,
  );
  if (!parts.length) return null;
  const reading = inset !== undefined;
  // PLAIN-14.6: beside the simplified version, a clause's bullet is its number, in the room a bullet had and more.
  const numbered = reading && !!ctx.numbers;
  const indent = numbered ? NUM_INDENT_REM : INDENT_REM;
  return (
    <ul className={cn('flex flex-col', numbered ? 'list-none pl-9' : 'list-disc pl-5 marker:text-muted-foreground', reading ? 'gap-2 text-reading' : 'gap-1 text-prose', className)}>
      {parts.map((part) => {
        if (part.kind === 'fold') {
          return (
            <li key={`fold-${part.key}`} className="list-none">
              <FoldLine runKey={part.key} ctx={ctx} label={plural(part.items.length, ...noun)} holds={numbered && ctx.specId ? anchorsIn(part.items, ctx.numbers!, ctx.specId) : undefined} />
            </li>
          );
        }
        const n = part.item;
        const c = part.whole ? whole(ctx) : ctx;
        const num = numbered ? ctx.numbers!.get(n) : undefined;
        const change = changeProps(n.state, ctx.highlight, n.text, true, inset, indent);
        return (
          <li key={`${part.at}-${n.text.slice(0, 40)}`} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined} data-run={part.opens} className={num ? 'relative' : undefined}>
            {num && (
              // Its right edge 0.5rem before the text, so a long number (1.1.1) grows to the left, never into the text.
              <span className="absolute top-1 right-full mr-2 font-mono text-meta whitespace-nowrap tabular-nums text-spec-text" data-field="spec-clause-n">
                {num}
              </span>
            )}
            <div {...change} id={num && ctx.specId ? clauseAnchor(ctx.specId, num) : undefined} className={cn(change.className, num && sideClass(ctx, num))} {...(num ? litHandlers(ctx, num) : {})}>
              <span className={stateClass(n.state, ctx, n.text)}>
                <Tag state={n.state} ctx={ctx} />
                <ClauseBody n={n} ctx={ctx} />
              </span>
            </div>
            {n.children.length > 0 && <ClauseList nodes={n.children} ctx={c} className={reading ? 'mt-2' : 'mt-1'} inset={reading ? inset + indent : undefined} scope={`${scope}>${n.text}`} />}
          </li>
        );
      })}
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
  const parts = foldRuns(
    nodes.filter((n) => there(n, ctx)),
    ctx.fold,
    'definitions',
    (n) => n.state !== 'same' || hasChange(n.children),
    (n) => n.text,
  );
  // PLAIN-10.5: definitions next to each other share a list; a fold line sits between two lists.
  const groups: (Extract<Part<Clause>, { kind: 'item' }>[] | Extract<Part<Clause>, { kind: 'fold' }>)[] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.kind === 'fold') groups.push(part);
    else if (Array.isArray(last)) last.push(part);
    else groups.push([part]);
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) =>
        Array.isArray(g) ? (
          <dl key={g[0]!.at} className="flex flex-col gap-3">
            {g.map((part) => (
              <Definition key={`${part.at}-${definitionName(part.item.text)?.name ?? part.item.text.slice(0, 20)}`} n={part.item} ctx={part.whole ? whole(ctx) : ctx} run={part.opens} />
            ))}
          </dl>
        ) : (
          <FoldLine
            key={`fold-${g.key}`}
            runKey={g.key}
            ctx={ctx}
            holds={g.items.flatMap((n) => {
              const d = definitionName(n.text);
              return d ? [defAnchor(d.name)] : [];
            })}
            label={plural(g.items.length, 'unchanged definition', 'unchanged definitions')}
          />
        ),
      )}
    </div>
  );
}

function Definition({ n, ctx, run }: { n: Clause; ctx: Ctx; run?: string }) {
  const d = definitionName(n.text);
  const old = n.oldText !== undefined ? n.oldText.replace(/^:[^:]+:\s*/, '') : undefined;
  return (
    <div id={d ? defAnchor(d.name) : undefined} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined} data-run={run} className="flex flex-col gap-0.5">
      <dt className="text-reading font-semibold">
        <Tag state={n.state} ctx={ctx} />
        {d?.name ?? ''}
      </dt>
      <dd className="flex flex-col gap-2 text-reading">
        <div {...changeProps(n.state, ctx.highlight, n.text)}>
          <span className={stateClass(n.state, ctx, n.text)}>
            {n.state === 'changed' && old !== undefined && ctx.highlight ? <Rewritten old={old} now={d?.body ?? n.text} ctx={ctx} /> : <Inline text={d?.body ?? n.text} ctx={ctx} />}
          </span>
        </div>
        {n.children.length > 0 && <ClauseList nodes={n.children} ctx={ctx} inset={0} scope={`definitions>${n.text}`} />}
      </dd>
    </div>
  );
}

const specGist = (spec: FunctionalSpec) => (spec.clauses[0] ? gist(spec.clauses[0].text) : '') || spec.id;

/** PLAIN-8.3, 9.2: a spec's change: "New spec", "Spec removed" or its counts; nothing when unchanged or not highlighted. */
function SpecChange({ spec, highlight, className }: { spec: FunctionalSpec; highlight: boolean; className?: string }) {
  if (!highlight) return null;
  if (spec.state === 'added') return <span className={cn('font-medium text-diff-added-text', className)}>New spec</span>;
  if (spec.state === 'removed') return <span className={cn('font-medium text-diff-removed-text', className)}>Spec removed</span>;
  if (!specTouched(spec)) return null;
  return (
    <span className={cn('flex gap-1.5 font-medium tabular-nums', className)} data-field="spec-counts">
      <Counts {...countStates([...spec.clauses, ...spec.tests, ...spec.notes])} />
    </span>
  );
}

/** PLAIN-10.5: the functional specs, each run of unchanged ones folded in Changes into a line naming the first and last. */
function SpecList({ specs, ctx }: { specs: readonly FunctionalSpec[]; ctx: Ctx }) {
  return foldRuns(specs, ctx.fold, 'specs', specTouched, (s) => s.id).map((part) => {
    if (part.kind === 'fold') {
      const line = (
        <FoldLine
          key={`fold-${part.key}`}
          runKey={part.key}
          ctx={ctx}
          holds={part.items.map((s) => specAnchor(s.id))}
          label={`${plural(part.items.length, 'unchanged spec', 'unchanged specs')}, ${part.items[0]!.id}${part.items.length > 1 ? ` to ${part.items.at(-1)!.id}` : ''}`}
          className="mt-6"
        />
      );
      // PLAIN-14.8: a fold line has nothing on the right.
      return ctx.side?.wide ? <SideRow key={`fold-${part.key}`}>{line}</SideRow> : line;
    }
    return (
      <Spec key={part.item.id} spec={part.item} ctx={part.whole ? whole(ctx) : ctx} run={part.opens} />
    );
  });
}

/** PLAIN-9.2 to 9.6: a functional spec: its heading, its clauses, its acceptance tests in a box, its notes behind a button. */
function Spec({ spec, ctx: outer, run }: { spec: FunctionalSpec; ctx: Ctx; run?: string }) {
  const side = outer.side;
  // PLAIN-14.6: beside the simplified version, its clauses, tests and notes go by their numbers.
  const numbers = useMemo(() => (side ? new Map(numberSpec(spec).map((x) => [x.clause, x.n])) : undefined), [side, spec]);
  const ctx: Ctx = side ? { ...outer, numbers, specId: spec.id } : outer;
  const tests = spec.tests.filter((n) => there(n, ctx));
  // PLAIN-10.5: in Changes, a spec's acceptance tests with no change fold into one line in place of their box.
  const testsKey = ctx.fold && !hasChange(spec.tests) ? runKey(`${spec.id} tests`, tests.map((n) => n.text)) : null;
  const testsFolded = testsKey !== null && !ctx.fold!.opened.has(testsKey);
  // PLAIN-11.2, 14.1: a changed spec is simplified; a removed one isn't.
  const group = spec.state === 'added' || spec.state === 'changed';
  const block = side && group ? side.blocks.get(spec.id) : undefined;
  const fresh = !!block && !block.stale;
  // PLAIN-14.15: in a narrow pane a fresh block takes the spec text's place, which "Show the spec text" opens under it.
  const swapped = !!side && !side.wide && fresh && block!.paragraphs.length > 0;
  const textShown = !swapped || side!.shownText.has(spec.id);
  const example = ctx.highlight && ctx.examples?.of.get(spec.id) ? <ExampleCard example={ctx.examples.of.get(spec.id)!} kept={ctx.examples.kept} spec={spec} ctx={ctx} /> : null;
  const headLit = ctx.light?.lit?.spec === spec.id && ctx.light.lit.head;
  const text = (
    <>
      <ClauseList nodes={spec.clauses} ctx={ctx} inset={0} scope={spec.id} />
      {tests.length > 0 &&
        (testsFolded ? (
          <FoldLine runKey={testsKey} ctx={ctx} label={plural(tests.length, 'unchanged acceptance test', 'unchanged acceptance tests')} holds={numbers ? anchorsIn(tests, numbers, spec.id) : undefined} />
        ) : (
          // PLAIN-9.4: the box's border and padding are 0.8125rem, so its bars still reach the gutter.
          <section aria-label="Acceptance tests" className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3" data-slot="spec-tests" data-run={testsKey ?? undefined}>
            <h4 className="flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
              <ListChecks aria-hidden className="size-3.5" />
              Acceptance tests
            </h4>
            <ClauseList nodes={spec.tests} ctx={testsKey ? whole(ctx) : ctx} inset={0.8125} scope={`${spec.id} tests`} noun={['unchanged acceptance test', 'unchanged acceptance tests']} />
          </section>
        ))}
      {spec.notes.length > 0 && <SpecNotes notes={spec.notes} ctx={ctx} scope={`${spec.id} notes`} />}
    </>
  );
  const article = (
    <article id={specAnchor(spec.id)} aria-label={spec.id} data-state={spec.state} className="mt-6 flex flex-col gap-3" data-outline data-where={spec.id} data-spec-id={spec.id} data-run={run}>
      {/* PLAIN-9.2: the id hangs in the margin when the pane has room for it, else it sits above the heading. */}
      {/* PLAIN-14.8: beside the simplified version, it sits above the heading. */}
      <header className="relative flex flex-col gap-0.5" data-spec-head>
        <span className={cn('font-mono text-meta tabular-nums text-muted-foreground', !side && '@min-[73rem]:absolute @min-[73rem]:top-1.5 @min-[73rem]:right-full @min-[73rem]:mr-6 @min-[73rem]:whitespace-nowrap')} data-field="spec-id">
          {spec.id}
        </span>
        <h3 className={cn('text-reading-title font-semibold tracking-tight', headLit && 'rounded-sm bg-spec/10')} title={swapped ? specGist(spec) : undefined}>
          {swapped && block!.title ? block!.title : specGist(spec)}
        </h3>
        <SpecChange spec={spec} highlight={ctx.highlight} className="text-meta" />
      </header>
      {!side && example}
      {side && !side.wide && group && (fresh ? <SimpleBody spec={spec} block={block!} example={example} ctx={ctx} /> : <SimpleMissing spec={spec} block={block} ctx={ctx} example={example} />)}
      {side && !side.wide && !group && example}
      {swapped && (
        <Button type="button" variant="quiet" size="line" className="self-start" aria-expanded={textShown} onClick={() => side!.onShowText(spec.id, !textShown)} data-field="spec-show-text">
          <ChevronDown aria-hidden className={cn('transition-transform', textShown && 'rotate-180')} />
          {textShown ? 'Hide the spec text' : 'Show the spec text'}
        </Button>
      )}
      {/* PLAIN-14.15: hidden, not left out, so the stepper and the rail still count its changes. */}
      <div className="flex flex-col gap-3" data-spec-text={textShown ? 'shown' : 'hidden'} data-spec={spec.id} hidden={!textShown}>
        {text}
      </div>
    </article>
  );
  if (!side?.wide) return article;
  // PLAIN-14.8: a changed spec's row: its text on the left, its simplified block on the right.
  return <SideRow right={group ? <SimpleBlock spec={spec} block={block} example={example} ctx={ctx} /> : null}>{article}</SideRow>;
}

/**
 * PLAIN-9.5: a spec's notes behind a button: open when one of them changed, then as you leave them.
 * In Changes, a spec none of whose notes changed has no button: its notes fold into a line (PLAIN-10.5).
 */
function SpecNotes({ notes, ctx, scope }: { notes: readonly Clause[]; ctx: Ctx; scope: string }) {
  // In Clean nothing is marked, so they open as an unchanged spec's do (PLAIN-10.4).
  const changed = ctx.highlight && hasChange(notes);
  const [open, setOpen] = useState<boolean | null>(null);
  // PLAIN-14.5, 14.7: a citation of a note, or Show them, opens them closed (reveal's OPEN_NOTES).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // As a click does: the changes in them join the rail and the stepper (PLAIN-9.5).
    const onOpen = () => {
      flushSync(() => setOpen(true));
      ctx.onFold?.();
    };
    el.addEventListener(OPEN_NOTES, onOpen);
    return () => el.removeEventListener(OPEN_NOTES, onOpen);
  });
  if (ctx.fold && !changed) return <Notes nodes={notes} ctx={ctx} scope={scope} />;
  const isOpen = open ?? changed;
  const count = notes.filter((n) => n.state !== 'removed').length;
  if (!count && !ctx.highlight) return null;
  const holds = !isOpen && ctx.numbers && ctx.specId ? anchorsIn(notes, ctx.numbers, ctx.specId) : [];
  return (
    <div ref={ref} className="flex flex-col gap-1.5" data-slot="spec-notes-fold" data-notes-holds={holds.length ? holds.join(' ') : undefined}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          setOpen(!isOpen);
          ctx.onFold?.();
        }}
        className="-mx-1.5 flex items-center gap-1.5 self-start rounded px-1.5 py-0.5 text-meta font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
        <span>Notes</span>{' '}
        <span className="font-normal tabular-nums">{count}</span>
      </button>
      {isOpen && <Notes nodes={notes} ctx={ctx} scope={scope} />}
    </div>
  );
}

/**
 * PLAIN-9.3: the spec the view's top edge is inside, pinned to the column's top once its heading has
 * scrolled away. It takes no room (`h-0`), so showing it never moves the text.
 */
function SpecStrip({ spec, highlight, side }: { spec: FunctionalSpec | undefined; highlight: boolean; side?: boolean }) {
  const jump = useJump();
  const strip = spec && (
        <a
          href={`#${specAnchor(spec.id)}`}
          onClick={jump(specAnchor(spec.id))}
          className="absolute top-0 right-0 -left-4 flex min-w-0 items-baseline gap-2 border-b border-border bg-background py-2 pl-4 text-meta hover:bg-accent"
          data-field="spec-strip"
        >
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{spec.id}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{specGist(spec)}</span>
          <SpecChange spec={spec} highlight={highlight} className="shrink-0" />
        </a>
  );
  return (
    <div className="sticky top-0 z-10 h-0" data-slot="spec-strip">
      {/* PLAIN-14.8: beside the simplified version, the strip spans the spec's column only. */}
      {side ? (
        <div className="mx-auto grid w-full max-w-[calc(68rem+1px)] grid-cols-[minmax(0,34fr)_1px_minmax(0,30fr)] gap-x-8">
          <div className="relative">{strip}</div>
        </div>
      ) : (
        strip
      )}
    </div>
  );
}

/** PLAIN-1.4: code spans, `:Concept:` terms and `§N.M` references inside a clause's text. */
function Inline({ text, ctx }: { text: string; ctx: Ctx }) {
  const jump = useJump();
  const out: ReactNode[] = [];
  text.split(/(`[^`]*`)/).forEach((part, i) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
      const code = part.slice(1, -1);
      // PLAIN-7.5, 7.8: an ability key is explained from the Checkout's catalogue, when it has one.
      if (ctx.answer.catalogue && ABILITY_KEY.test(code)) {
        out.push(
          <button key={i} type="button" className="rounded-sm bg-muted px-1 font-mono text-prose underline decoration-dotted underline-offset-2" data-term="ability" aria-haspopup="dialog" {...cardHandlers(code, 'ability', ctx)}>
            {code}
          </button>,
        );
        return;
      }
      out.push(
        <code key={i} className="rounded-sm bg-muted px-1 font-mono text-prose">
          {code}
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
        const other = ctx.answer.specs?.[bit];
        if (ctx.specIds.has(bit)) {
          // PLAIN-1.4, 7.1: a click still scrolls to it; hover or focus shows it.
          out.push(
            <a key={key} href={`#${specAnchor(bit)}`} onClick={jump(specAnchor(bit))} className="underline underline-offset-2" data-ref="spec" aria-haspopup={ctx.specById ? 'dialog' : undefined} {...(ctx.specById ? cardHandlers(bit, 'spec', ctx) : {})}>
              {bit}
            </a>,
          );
        } else if (other && ctx.hrefOf && ctx.onOpenModule) {
          // PLAIN-7.2: another Module's spec opens that Module at it.
          const open = ctx.onOpenModule;
          out.push(
            <a key={key} href={`${ctx.hrefOf(other.module)}#${specAnchor(bit)}`} onClick={moduleClick(() => open(other.module, bit))} className="underline underline-offset-2" data-ref="other-spec" aria-haspopup="dialog" {...cardHandlers(bit, 'spec', ctx)}>
              {bit}
            </a>,
          );
        } else {
          // PLAIN-7.4: in no Module under the folder.
          out.push(
            <span key={key} title={ctx.answer.specs ? `No functional spec ${bit} in this repo's Modules` : undefined}>
              {bit}
            </span>,
          );
        }
        return;
      }
      if (bit) out.push(bit);
    });
  });
  return <>{out}</>;
}

/** PLAIN-1.4, 2.2: a Concept: a link to its own definition, a predefined one, or another Module's on hover. */
function Term({ name, ctx }: { name: string; ctx: Ctx }) {
  const jump = useJump();
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
      {...cardHandlers(name, 'concept', ctx)}
    >
      {name}
    </button>
  );
}

type CardKind = 'concept' | 'spec' | 'ability';
interface Card {
  kind: CardKind;
  name: string;
  el: HTMLElement;
}

/** PLAIN-2.2, 7.1, 7.5: hover and focus open the card for a term, a `§` or an ability key; leaving it closes it. */
function cardHandlers(name: string, kind: CardKind, ctx: Ctx) {
  return {
    onPointerEnter: (e: { currentTarget: HTMLElement }) => ctx.onTerm(name, e.currentTarget, 'enter', kind),
    onPointerLeave: (e: { currentTarget: HTMLElement }) => ctx.onTerm(name, e.currentTarget, 'leave', kind),
    onFocus: (e: { currentTarget: HTMLElement }) => ctx.onTerm(name, e.currentTarget, 'focus', kind),
    onBlur: (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
      // Focus moving into the card keeps it open.
      if (e.relatedTarget instanceof Node && document.querySelector('[data-slot="concept-card"]')?.contains(e.relatedTarget)) return;
      ctx.onTerm(name, e.currentTarget, 'blur', kind);
    },
  };
}

/** PLAIN-2.2 to 2.4, 7.1 to 7.8: one card for whichever term, `§` or ability key the pointer or focus is on. */
function ConceptCard({
  card,
  answer,
  specById,
  onEnter,
  onLeave,
  onClose,
  onOpenModule,
  hrefOf,
}: {
  card: Card | null;
  answer: PlainAnswer;
  specById: ReadonlyMap<string, FunctionalSpec>;
  onEnter(): void;
  onLeave(): void;
  onClose(): void;
  onOpenModule(path: string, at?: string): void;
  hrefOf(path: string): string;
}) {
  // The card's anchor is the term under the pointer or focus: a ref object made per term.
  const anchor = useMemo(() => ({ current: card?.el ?? null }), [card]);
  const c = card?.kind === 'concept' ? answer.concepts[card.name] : undefined;
  const other = card?.kind === 'spec' ? answer.specs?.[card.name] : undefined;
  const label = !card
    ? ''
    : card.kind === 'spec'
      ? `${card.name}, in ${moduleName(other?.module ?? '') || 'this Module'}`
      : card.kind === 'ability'
        ? `${card.name}, an ability`
        : `${card.name}, defined in ${c ? moduleName(c.module) : 'no Module this one reads'}`;
  return (
    <Popover open={!!card} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor virtualRef={anchor as { current: HTMLElement }} />
      {card && (
        <PopoverContent
          side="bottom"
          align="start"
          data-slot="concept-card"
          aria-label={label}
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
          {card.kind === 'spec' ? (
            <SpecBody id={card.name} own={specById.get(card.name)} other={other} onGo={onClose} onOpenModule={onOpenModule} hrefOf={hrefOf} />
          ) : card.kind === 'ability' ? (
            <AbilityBody name={card.name} abilities={answer.abilities ?? {}} />
          ) : (
            <ConceptBody name={card.name} concept={c} missing={answer.missing} onOpenModule={onOpenModule} hrefOf={hrefOf} />
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}

function ConceptBody({ name, concept, missing, onOpenModule, hrefOf }: { name: string; concept: PlainConcept | undefined; missing: readonly string[]; onOpenModule(path: string, at?: string): void; hrefOf(path: string): string }) {
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
  // A definition the branch removed has no lines at the working tree.
  const { state, clauses: body } = branchChange(concept.lines.length ? concept.lines : null, concept.baseLines);
  return (
    <>
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 text-body font-semibold">{name}</p>
        <Button asChild variant="secondary" size="line" className="font-normal">
          <a href={hrefOf(`${concept.module}.plain`)} onClick={moduleClick(() => onOpenModule(`${concept.module}.plain`))}>
            <ActionIcon id="open" />
            Open {moduleName(concept.module)}
          </a>
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        Defined in <span className="text-foreground">{concept.module}</span>
      </p>
      {state !== 'same' && (
        <p className="text-meta font-medium" data-field="concept-changed">
          {BRANCH_LABEL[state]}
        </p>
      )}
      <ClauseList nodes={body.map(stripName)} ctx={CARD_CTX} className="pl-4" />
    </>
  );
}

/** Inside a card, terms, `§` and keys are text: a card never opens another. */
const CARD_CTX: Ctx = { own: new Set(), specIds: new Set(), answer: { concepts: {} } as unknown as PlainAnswer, justChanged: new Set(), highlight: true, onTerm: () => {} };

const BRANCH_LABEL: Record<Exclude<Clause['state'], 'same'>, string> = { added: 'Added in this branch', removed: 'Removed in this branch', changed: 'Changed in this branch' };

/**
 * PLAIN-2.3, 7.3: another Module's clauses at the working tree (null: gone) and the base (null: new),
 * as one change, the clauses marked as PLAIN-1.6 marks them.
 */
function branchChange(lines: readonly string[] | null, baseLines: readonly string[] | null): { state: Clause['state']; clauses: Clause[] } {
  if (lines === null) return { state: 'removed', clauses: parseClauses(baseLines ?? []).map(asRemoved) };
  if (baseLines === null) return { state: 'added', clauses: parseClauses(lines) };
  if (lines.join('\n') === baseLines.join('\n')) return { state: 'same', clauses: parseClauses(lines) };
  return { state: 'changed', clauses: compareClauses(baseLines, lines) };
}

/** PLAIN-7.1 to 7.3: a functional spec, this Module's (already compared) or another's (compared here). */
function SpecBody({ id, own, other, onGo, onOpenModule, hrefOf }: { id: string; own: FunctionalSpec | undefined; other: PlainSpecRef | undefined; onGo(): void; onOpenModule(path: string, at?: string): void; hrefOf(path: string): string }) {
  const jump = useJump();
  let clauses: Clause[];
  let state: Clause['state'];
  let tests: number;
  let notes: number;
  if (own) {
    ({ clauses, state } = own);
    tests = own.tests.filter((t) => t.state !== 'removed').length;
    notes = own.notes.filter((t) => t.state !== 'removed').length;
  } else if (other) {
    ({ clauses, state } = branchChange(other.lines, other.baseLines));
    ({ tests, notes } = other);
  } else return null;
  const first = clauses.find((c) => c.state !== 'removed') ?? clauses[0];
  const counts = [tests ? `${tests} acceptance test${tests === 1 ? '' : 's'}` : '', notes ? `${notes} note${notes === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const action = own ? `Go to ${id}` : `Open ${moduleName(other!.module)} at ${id}`;
  return (
    <>
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 text-body font-semibold">{first ? gist(first.text) : id}</p>
        {own ? (
          <Button asChild variant="secondary" size="line" className="font-normal">
            <a
              href={`#${specAnchor(id)}`}
              onClick={(e) => {
                jump(specAnchor(id))(e);
                onGo();
              }}
            >
              {action}
            </a>
          </Button>
        ) : (
          <Button asChild variant="secondary" size="line" className="font-normal">
            <a href={`${hrefOf(other!.module)}#${specAnchor(id)}`} onClick={moduleClick(() => onOpenModule(other!.module, id))}>
              {action}
            </a>
          </Button>
        )}
      </div>
      <p className="text-meta text-muted-foreground">
        <span className="font-mono">{id}</span>
        {other && (
          <>
            {' '}
            in <span className="text-foreground">{other.module}</span>
          </>
        )}
      </p>
      {state !== 'same' && (
        <p className="text-meta font-medium" data-field="ref-changed">
          {BRANCH_LABEL[state]}
        </p>
      )}
      <ClauseList nodes={clauses} ctx={CARD_CTX} className="pl-4" />
      {counts && (
        <p className="text-meta text-muted-foreground" data-field="spec-counts">
          {counts}, not shown here.
        </p>
      )}
    </>
  );
}

const LEAF_LABEL: Record<AbilityLeafKind, string> = {
  permission: 'permission',
  feature: 'plan feature',
  addon: 'addon',
  flag: 'flag',
  userType: 'user type',
  fact: 'fact',
  actor: 'fact about the reader',
  setting: 'organization setting',
  custom: 'custom rule',
  ability: 'ability',
};

/** PLAIN-7.5: a rule's conditions as nested lists, in words. */
function RuleView({ rule, abilities }: { rule: AbilityRule; abilities: Readonly<Record<string, PlainAbility>> }) {
  if ('allOf' in rule || 'anyOf' in rule) {
    const all = 'allOf' in rule;
    const parts = all ? rule.allOf : rule.anyOf;
    return (
      <div>
        <p>{all ? 'All of' : 'Any of'}</p>
        <ul className="ml-4 list-disc">
          {parts.map((r, i) => (
            <li key={i}>
              <RuleView rule={r} abilities={abilities} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if ('not' in rule) {
    return (
      <div>
        <p>Not</p>
        <ul className="ml-4 list-disc">
          <li>
            <RuleView rule={rule.not} abilities={abilities} />
          </li>
        </ul>
      </div>
    );
  }
  const named = rule.kind === 'ability' ? (abilities[rule.name]?.head ?? abilities[rule.name]?.base) : null;
  return (
    <p data-field="rule-leaf">
      {LEAF_LABEL[rule.kind]} <code className="rounded-sm bg-muted px-1 font-mono">{rule.name}</code>
      {rule.state && <span className="text-muted-foreground"> ({rule.state})</span>}
      {named && <span className="text-muted-foreground">: {named.description}</span>}
    </p>
  );
}

/** A doc comment's paragraphs, its hard wraps joined. */
const paragraphs = (doc: string) => doc.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

function EntryView({ entry, abilities }: { entry: AbilityEntry; abilities: Readonly<Record<string, PlainAbility>> }) {
  return (
    <>
      <p className="text-body">{entry.description}</p>
      {paragraphs(entry.doc).map((p, i) => (
        <p key={i} className="text-meta text-muted-foreground">
          <Inline text={p} ctx={CARD_CTX} />
        </p>
      ))}
      {entry.rule ? (
        <div className="flex flex-col gap-1 text-meta" data-field="rule">
          <p className="font-medium">Allowed when</p>
          <RuleView rule={entry.rule} abilities={abilities} />
        </div>
      ) : (
        entry.source && (
          <div className="flex flex-col gap-1 text-meta" data-field="rule-source">
            <p className="font-medium">Rule as written</p>
            <pre className="whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono">{entry.source}</pre>
          </div>
        )
      )}
    </>
  );
}

/** PLAIN-7.5, 7.7, 7.8: an ability key, from the Checkout's catalogue at head and base. */
function AbilityBody({ name, abilities }: { name: string; abilities: Readonly<Record<string, PlainAbility>> }) {
  const a = abilities[name];
  const title = <p className="font-mono text-body font-semibold">{name}</p>;
  if (!a) {
    return (
      <>
        {title}
        <p className="text-meta text-muted-foreground" data-field="ability-missing">
          Not in this Checkout&apos;s abilities catalogue.
        </p>
      </>
    );
  }
  const { head, base } = a;
  // A rule that names a constant reads the same as written when only the constant changed.
  const changed = !!head && !!base && (head.description !== base.description || head.source !== base.source || JSON.stringify(head.rule) !== JSON.stringify(base.rule));
  const label = !head ? BRANCH_LABEL.removed : !base ? BRANCH_LABEL.added : changed ? BRANCH_LABEL.changed : null;
  const shown = head ?? base!;
  return (
    <>
      {title}
      {label && (
        <p className="text-meta font-medium" data-field="ref-changed">
          {label}
        </p>
      )}
      <EntryView entry={shown} abilities={abilities} />
      {changed && (
        <div className="flex flex-col gap-1 border-l-2 border-border pl-3" data-field="ability-before">
          <p className="text-meta font-medium">Before</p>
          <EntryView entry={{ ...base!, doc: '' }} abilities={abilities} />
        </div>
      )}
      <p className="text-meta text-muted-foreground" data-field="ability-file">
        {shown.file}:{shown.line}
      </p>
    </>
  );
}

const asRemoved = (n: Clause): Clause => ({ ...n, state: 'removed', children: n.children.map(asRemoved) });

/** A definition's first clause without its `:Name:`, which the card's title already says. */
function stripName(n: Clause, i: number): Clause {
  if (i !== 0) return n;
  return { ...n, text: n.text.replace(/^:[^:]+:\s*/, ''), oldText: n.oldText?.replace(/^:[^:]+:\s*/, '') };
}

/** PLAIN-12.8: a spec's note that speaks of the old app. */
const OLD_APP_NOTE = /\b(?:Ember|legacy|old app)\b|\.(?:gts|hbs)\b/i;

/** PLAIN-11.9: a card's tests in one line: "2 Playwright tests: 1 passed, 1 failed". */
function testsLine(tests: readonly PlainExampleTest[]): string {
  const failed = tests.filter((t) => t.problem?.startsWith('Its test failed')).length;
  const unrun = tests.filter((t) => t.problem && !t.problem.startsWith('Its test failed')).length;
  const passed = tests.length - failed - unrun;
  if (tests.length === 1) return `1 Playwright test: ${passed ? 'passed' : failed ? 'failed' : "didn't run"}`;
  const parts = [passed && `${passed} passed`, failed && `${failed} failed`, unrun && `${unrun} didn't run`].filter(Boolean);
  return `${tests.length} Playwright tests: ${parts.join(', ')}`;
}

const VERDICT_ORDER: readonly NonNullable<PlainPortRow['verdict']>[] = ['covered', 'partly', 'not found', 'cut', 'still in the spec'];
/** PLAIN-12.4: the verdicts that need you, at full strength with their words; the others are quiet. */
const NEEDS_LOOK: ReadonlySet<string> = new Set(['partly', 'not found', 'still in the spec']);

/** PLAIN-11.15: what a PR's run is doing before its tests. */
const PREPARING: Record<string, string> = {
  worktree: 'Checking out the PR…',
  copying: "Copying the PR's dependencies…",
  installing: "Installing the PR's dependencies…",
};

/**
 * PLAIN-11.1, 11.13, 12.5, 14.1, 14.13: the Changes card's presses: Show examples and Simplify side by
 * side, each run's wait and failure, the port's tally.
 */
function ChangesBar({ examples, simple }: { examples?: ExamplesUi; simple?: SimpleUi }) {
  const sp = simple?.answer ?? null;
  const simplifying = !!sp?.running || !!simple?.pressing;
  const simpleError = simple ? (simple.pressError ?? sp?.error ?? null) : null;
  const simplifyButton = simple && !simplifying && (
    <Button
      type="button"
      variant="soft"
      size="line"
      onClick={simple.onSimplify}
      title="Claude rewrites the changed specs in simple words, shown beside them. Each paragraph cites its clauses."
      data-field="spec-simplify"
    >
      {sp?.simple ? 'Simplify again' : 'Simplify'}
    </Button>
  );
  const simpleRows = (
    <>
      {simplifying && (
        <Loading
          label={sp?.running ? `Simplifying ${plural(sp.running.specs, 'spec', 'specs')}…` : 'Simplifying…'}
          hintAfter={0}
          action={
            <Button type="button" variant="quiet" size="line" onClick={simple!.onCancel} data-field="spec-simplify-cancel">
              Cancel
            </Button>
          }
        />
      )}
      {simpleError && !simplifying && <Alert title={simpleError} data-field="spec-simplify-error" />}
    </>
  );
  if (!examples) {
    return (
      <div className="flex flex-col gap-2 border-t border-border pt-2" data-slot="spec-examples-bar">
        {simplifyButton && <div className="flex flex-wrap items-center gap-2">{simplifyButton}</div>}
        {simpleRows}
      </div>
    );
  }
  const ui = examples;
  const a = ui.answer;
  const kept = a?.examples ?? null;
  const running = a?.running ?? null;
  const tally = new Map<string, number>();
  for (const g of kept?.groups ?? []) for (const r of g.rows) if (r.verdict) tally.set(r.verdict, (tally.get(r.verdict) ?? 0) + 1);
  const port = VERDICT_ORDER.filter((v) => tally.get(v)).map((v) => `${tally.get(v)} ${v}`);
  const error = ui.pressError ?? a?.error ?? null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2" data-slot="spec-examples-bar">
      {port.length > 0 && (
        <p className="text-meta text-muted-foreground" data-field="spec-port-tally">
          Port: {port.join(' · ')}
          {kept && kept.rowsTotal > kept.rowsChecked && ` (${kept.rowsChecked} of ${kept.rowsTotal} rows checked)`}
        </p>
      )}
      {running?.mine || ui.pressing ? (
        <>
        <Loading
          label={
            running?.phase === 'writing'
              ? 'Writing examples…'
              : running?.phase === 'pictures'
                ? 'Taking the pictures…'
              : running?.mine && running.phase in PREPARING
                ? PREPARING[running.phase]!
                : running && running.tests > 0
                ? `Running ${plural(running.tests, 'Playwright test', 'Playwright tests')}…`
                : 'Finding the Playwright tests…'
          }
          // Cancel is there from the start, as a summary's is (TOPIC-11.6).
          hintAfter={0}
          action={
            <Button type="button" variant="quiet" size="line" onClick={ui.onCancel} data-field="spec-examples-cancel">
              Cancel
            </Button>
          }
        />
        {simplifyButton && <div className="flex flex-wrap items-center gap-2">{simplifyButton}</div>}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="soft"
            size="line"
            onClick={ui.onShow}
            disabled={!!running}
            title={
              running
                ? `Examples for ${running.module} are being made`
                : ui.pr !== null
                  ? `Runs #${ui.pr}'s Playwright tests that name each changed spec on this Mac, in a worktree of its head, and writes an example of each with Claude`
                  : 'Runs the Playwright tests that name each changed spec, and writes an example of each with Claude'
            }
            data-field="spec-examples-show"
          >
            {kept ? 'Show examples again' : 'Show examples'}
          </Button>
          {simplifyButton}
        </div>
      )}
      {error && !running?.mine && <Alert title={error} data-field="spec-examples-error" />}
      {simpleRows}
    </div>
  );
}

/** PLAIN-11.9 to 11.11, 12.4: a changed spec's card: its picture, its example, its tests, the old app's rows. */
function ExampleCard({ example: g, kept, spec, ctx }: { example: PlainExample; kept: NonNullable<PlainExamplesAnswer['examples']>; spec: FunctionalSpec; ctx: Ctx }) {
  const now = useNow(60_000);
  const oldNotes = spec.notes.filter((n) => n.state !== 'removed' && OLD_APP_NOTE.test(n.text));
  const [open, setOpen] = useState<number | null>(null);
  // A newer answer may hold fewer frames than the one the dialog was opened on: it closes, for good.
  const at = open !== null && open < g.frames.length ? open : null;
  if (open !== null && at === null) setOpen(null);
  // PLAIN-13.5: frames kept since PLAIN-13 are a storyboard's panels; older ones read as PLAIN-11.9 drew them.
  const story = g.frames.length > 0 && g.frames.every((f) => f.steps !== undefined);
  const first = story ? undefined : g.frames[0];
  const tests = g.tests.length;
  return (
    <section aria-label={`Example of ${g.spec}`} className="@container grid gap-3 rounded-md bg-muted p-3 font-sans" data-slot="spec-example" data-spec={g.spec}>
      {story && <Storyboard example={g} kept={kept} onOpen={setOpen} />}
      <div className={cn('grid gap-3', first && '@min-[36rem]:grid-cols-[12.5rem_minmax(0,1fr)]')}>
        {first && (
          <figure className="flex min-w-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(0)}
              className="overflow-hidden rounded border border-border"
              aria-label={`Show ${g.spec}'s pictures large`}
              data-field="spec-example-picture"
            >
              <img src={frameUrl(kept.key, first.name)} alt={first.caption} className="block w-full" />
            </button>
            <figcaption className="text-meta text-muted-foreground">
              {first.caption}
              <NotThereYet frame={first} />
            </figcaption>
          </figure>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          {(g.example || g.outOfDate) && (
            <div className="flex flex-wrap items-center gap-2">
              {g.example && <span className="text-meta font-medium text-muted-foreground">Example</span>}
              {g.outOfDate && (
                <Chip tone="info" data-field="spec-example-stale">
                  Out of date
                </Chip>
              )}
            </div>
          )}
          {g.example ? (
            <p className="text-prose" data-field="spec-example-text">
              {g.example}
            </p>
          ) : g.refused ? (
            <p className="text-meta text-muted-foreground" data-field="spec-example-refused">
              {g.refused}
            </p>
          ) : (
            !story &&
            spec.tests.length > 0 && (
              <p className="text-meta text-muted-foreground" data-field="spec-example-own-tests">
                Its acceptance tests, below, walk through it.
              </p>
            )
          )}
          {g.shows && <p className="text-meta text-muted-foreground" data-field="spec-example-shows">{g.shows}</p>}
          {tests === 0 ? (
            <p className="text-meta text-muted-foreground" data-field="spec-example-no-test">No Playwright test names {g.spec}</p>
          ) : (
            <p className="text-meta text-muted-foreground" title={g.tests.map((t) => [t.title, `${t.file}:${t.line}`, t.problem].filter(Boolean).join(' · ')).join('\n')} data-field="spec-example-tests">
              {testsLine(g.tests)}
            </p>
          )}
          {g.example && (
            <p className="text-meta text-muted-foreground" data-field="spec-example-by">
              {[`Written by Claude from ${g.spec}${tests ? ` and its ${tests === 1 ? 'test' : 'tests'}` : ''}`, modelName(kept.model), kept.costUsd === null ? null : formatCost(kept.costUsd), `${formatAge(now - kept.writtenAt)} ago`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>
      {(g.ported || oldNotes.length > 0) && <OldApp example={g} notes={oldNotes} ctx={ctx} />}
      {at !== null && <FramesDialog example={g} kept={kept} at={at} onAt={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

const pct = (n: number) => `${n * 100}%`;

/** PLAIN-13.2, 13.5: a panel's picture cropped around its box, the box ringed (for an absence, where it searched); "Not there" for an absence. A picture without a box is the whole screen. */
function Shot({ frame: f, src }: { frame: PlainExampleFrame; src: string }) {
  const box = f.box ?? null;
  const screen = f.screen ?? { w: 16, h: 10 };
  if (!box)
    return (
      <div className="relative" data-field="spec-shot" data-crop="none">
        <img src={src} alt={f.caption} className="block w-full" />
        {f.absent && <NotThere />}
      </div>
    );
  const r = cropRegion(box, screen);
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${r.w * screen.w} / ${r.h * screen.h}` }} data-field="spec-shot" data-crop="box">
      <img src={src} alt={f.caption} className="absolute max-w-none" style={{ width: pct(1 / r.w), height: pct(1 / r.h), left: pct(-r.x / r.w), top: pct(-r.y / r.h) }} />
      <span
        className="pointer-events-none absolute rounded-sm border-2 border-ring ring-4 ring-ring/25"
        style={{ left: pct((box.x - r.x) / r.w), top: pct((box.y - r.y) / r.h), width: pct(box.w / r.w), height: pct(box.h / r.h) }}
        data-field="spec-shot-ring"
      />
      {f.absent && <NotThere />}
    </div>
  );
}

function NotThere() {
  return (
    <span className="absolute top-1.5 right-1.5" data-field="spec-shot-absent">
      <Chip tone="info">Not there</Chip>
    </span>
  );
}

/** PLAIN-13.4: the steps between two panels: three named, then how many more; every one in the tooltip. */
function stepsLine(f: PlainExampleFrame): { label: string; tip: string } {
  if (f.newTest) return { label: 'Next test', tip: f.test };
  const steps = f.steps ?? [];
  return { label: steps.length > 3 ? `${steps.slice(0, 3).join(', ')}, +${steps.length - 3} more` : steps.join(', '), tip: steps.join('\n') };
}

/** PLAIN-13.5: a group's panels in the order they ran, the steps between them; under 36rem, the first and how many. */
function Storyboard({ example: g, kept, onOpen }: { example: PlainExample; kept: NonNullable<PlainExamplesAnswer['examples']>; onOpen(n: number): void }) {
  const panel = (f: PlainExampleFrame, i: number) => (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5">
      <button type="button" onClick={() => onOpen(i)} className="overflow-hidden rounded border border-border bg-background" aria-label={`Show ${g.spec}'s pictures large, at step ${i + 1}`} data-field="spec-example-picture">
        <Shot frame={f} src={frameUrl(kept.key, f.name)} />
      </button>
      <figcaption className="text-meta text-muted-foreground">
        {f.caption}
        <NotThereYet frame={f} />
      </figcaption>
    </figure>
  );
  return (
    <>
      <ol className="flex min-w-0 items-start overflow-x-auto pb-1 @max-[36rem]:hidden" aria-label={`${g.spec}, step by step`} data-field="spec-story">
        {g.frames.map((f, i) => {
          const s = stepsLine(f);
          return (
            // Two panels can share a picture, ringing two things on one screen (PLAIN-13.3).
            <Fragment key={`${i}:${f.name}`}>
              {i > 0 && (
                <li className="flex w-24 shrink-0 flex-col items-center gap-1 px-1.5 pt-10" title={s.tip || undefined} data-field="spec-story-step">
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                  {s.label && <span className="text-center text-meta font-medium break-words text-foreground">{s.label}</span>}
                </li>
              )}
              <li className="w-56 shrink-0" data-field="spec-story-panel">
                {panel(f, i)}
              </li>
            </Fragment>
          );
        })}
      </ol>
      <div className="hidden flex-col items-start gap-1.5 @max-[36rem]:flex" data-field="spec-story-narrow">
        <div className="w-full max-w-60">{panel(g.frames[0]!, 0)}</div>
        {g.frames.length > 1 && (
          <Button type="button" variant="quiet" size="line" onClick={() => onOpen(0)} data-field="spec-story-all">
            {g.frames.length} steps
          </Button>
        )}
      </div>
    </>
  );
}

/** PLAIN-12.4: the port docs' rows for a spec, as written, each with its verdict. */
function OldApp({ example: g, notes, ctx }: { example: PlainExample; notes: readonly Clause[]; ctx: Ctx }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2" data-field="spec-example-old-app">
      <h4 className="text-meta font-medium text-muted-foreground">The old app</h4>
      {!g.ported ? (
        <p className="text-meta text-muted-foreground" data-field="spec-example-no-port-doc">
          No port doc covers {g.spec}
        </p>
      ) : g.rows.length === 0 ? (
        <p className="text-meta text-muted-foreground" data-field="spec-example-no-row">
          No port-doc row names {g.spec}
          {g.mentionedIn.length > 0 && `; ${g.mentionedIn.map((d) => d.split('/').pop()).join(', ')} ${g.mentionedIn.length === 1 ? 'mentions' : 'mention'} it`}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {g.rows.map((r) => (
            <li key={`${r.doc}:${r.line}`} className="flex min-w-0 flex-col gap-0.5" title={`${r.doc}:${r.line}`} data-field="spec-example-row" data-verdict={r.verdict ?? ''}>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="min-w-0 text-prose break-words">{r.capability}</span>
                {r.verdict && (
                  <span className={cn('text-meta font-medium', NEEDS_LOOK.has(r.verdict) ? 'text-foreground' : 'text-muted-foreground')} data-field="spec-example-verdict">
                    {r.verdict}
                  </span>
                )}
              </span>
              {r.missing && <span className="text-meta text-foreground">Missing: {r.missing}</span>}
              {(r.answer || r.parity || r.source) && (
                <span className="text-meta break-words text-muted-foreground">{[r.answer, r.parity && `Parity: ${r.parity}`, r.source].filter(Boolean).join(' · ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* PLAIN-12.8: the spec's own notes about the old app, which sit behind a button under it. */}
      {notes.length > 0 && (
        <div className="flex flex-col gap-1" data-field="spec-example-old-notes">
          <h5 className="text-meta text-muted-foreground">From its notes</h5>
          {notes.map((n, k) => (
            <p key={k} className="min-w-0 text-meta break-words text-muted-foreground">
              <Inline text={n.text} ctx={ctx} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** PLAIN-11.17: under a picture from a test that failed, what the change adds that it doesn't show yet. */
function NotThereYet({ frame }: { frame: PlainExampleFrame }) {
  if (!frame.failed) return null;
  return (
    <span className="block text-foreground" data-field="spec-example-not-yet">
      {frame.missing ? `Not there yet: ${frame.missing}` : 'Its test failed after this picture.'}
    </span>
  );
}

/** PLAIN-11.10: a spec's frames large, each with its caption and its test, ←/→ between them. */
function FramesDialog({ example: g, kept, at, onAt, onClose }: { example: PlainExample; kept: NonNullable<PlainExamplesAnswer['examples']>; at: number; onAt(n: number): void; onClose(): void }) {
  const f = g.frames[at]!;
  const n = g.frames.length;
  const go = (d: number) => onAt((at + d + n) % n);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        // 1000 px, 30% over the 768 px it had (Dario, 2026-11-09); the frames are 800 px, so past that they stretch.
        className="gap-3 p-4 sm:max-w-[62.5rem]"
        data-field="spec-example-frames"
        onKeyDown={(e) => {
          if (n < 2 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
          e.preventDefault();
          go(e.key === 'ArrowRight' ? 1 : -1);
        }}
      >
        <DialogTitle className="text-body font-semibold">
          {g.spec} · {f.caption}
        </DialogTitle>
        <DialogDescription className="text-meta text-muted-foreground">
          From the Playwright test “{f.test}”{n > 1 ? ` · ${at + 1} of ${n}` : ''}
          {at > 0 && f.steps && (f.newTest || f.steps.length > 0) && (
            <span className="block text-foreground" data-field="spec-example-after">
              {f.newTest ? 'Next test' : `After: ${f.steps.join(', ')}`}
            </span>
          )}
          <NotThereYet frame={f} />
        </DialogDescription>
        <div className="relative overflow-hidden rounded border border-border" data-field="spec-example-large">
          <img src={frameUrl(kept.key, f.name)} alt={f.caption} className="block w-full" />
          {/* PLAIN-13.7: the box ringed and the rest dimmed; an absence says so. */}
          {f.box && (
            <span
              className="pointer-events-none absolute rounded-sm border-2 border-ring outline-[200vmax] outline-black/35 outline-solid"
              style={{ left: pct(f.box.x), top: pct(f.box.y), width: pct(f.box.w), height: pct(f.box.h) }}
              data-field="spec-shot-ring"
            />
          )}
          {f.absent && <NotThere />}
        </div>
        {n > 1 && (
          <div className="flex items-center justify-end gap-1">
            <IconButton label="Previous picture" onClick={() => go(-1)}>
              <ChevronLeft />
            </IconButton>
            <IconButton label="Next picture" onClick={() => go(1)}>
              <ChevronRight />
            </IconButton>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// PLAIN-14: the simplified version

/** PLAIN-14.7: a numbered clause's anchor in the view. */
const clauseAnchor = (spec: string, n: string) => `${specAnchor(spec)}-n${n.replace(/\./g, '-')}`;
/** PLAIN-14.11: a spec's simplified block's anchor. */
const blockAnchor = (spec: string) => `${specAnchor(spec)}-simple`;

/** PLAIN-10.6, 14.7: the anchors of the numbered clauses a fold holds, nested ones too, so a citation of one opens it. */
function anchorsIn(items: readonly Clause[], numbers: ReadonlyMap<Clause, string>, spec: string): string[] {
  const out: string[] = [];
  const walk = (ns: readonly Clause[]) =>
    ns.forEach((c) => {
      const n = numbers.get(c);
      if (n) out.push(clauseAnchor(spec, n));
      walk(c.children);
    });
  walk(items);
  return out;
}

/** PLAIN-14.12: each functional spec's text as this view reads it, at the base and now. */
function specTexts(c: Compared | null): ReadonlyMap<string, string> {
  return new Map((c?.module.specs ?? []).map((s) => [s.id, JSON.stringify(s)]));
}

/**
 * PLAIN-14.12: the version as read, with a block whose spec changed since that read hidden at once, as the
 * next read will say, so an edited spec never shows its old paragraphs beside its new clauses.
 */
function sinceRead(sp: PlainSimpleAnswer | null, then: ReadonlyMap<string, string> | null, now: ReadonlyMap<string, string>): PlainSimpleAnswer | null {
  const kept = sp?.simple;
  if (!sp || !kept || !then || then === now) return sp;
  const changed = (id: string) => then.get(id) !== now.get(id);
  const blocks = kept.blocks.map((b): PlainSimpleBlock => (!b.stale && changed(b.spec) ? { spec: b.spec, stale: true, title: null, paragraphs: [], leftOut: [], failed: null } : b));
  const lead = kept.lead && !kept.lead.stale && kept.lead.lines.some((l) => l.cites.some((c) => changed(c.replace(/ notes?$/, '')))) ? { stale: true, lines: [] } : kept.lead;
  if (lead === kept.lead && blocks.every((b, i) => b === kept.blocks[i])) return sp;
  // PLAIN-14.11: the score was of paragraphs no longer shown; the next read scores what is.
  return { ...sp, simple: { ...kept, blocks, lead, readingEase: null } };
}

/** The event that opens a spec's closed Notes for a citation (PLAIN-14.7). */
const OPEN_NOTES = 'lookout-open-notes';

const sameLit = (a: Lit, b: Lit) => a.spec === b.spec && a.kind === b.kind && a.key === b.key;

/** PLAIN-14.7, 14.9: a light held while the pointer is on it or it has focus: one ending doesn't put out the other. */
function useHold(light: Pick<Light, 'setLit' | 'unlit'> | undefined, l: Lit): (on: boolean, how: 'pointer' | 'focus') => void {
  const held = useRef({ pointer: false, focus: false });
  return (on, how) => {
    held.current[how] = on;
    if (held.current.pointer || held.current.focus) light?.setLit(l);
    else light?.unlit(l);
  };
}

/** PLAIN-14.7, 14.9: what lights for what the pointer or focus is on. */
function litSets(l: Lit | null, blocks: ReadonlyMap<string, PlainSimpleBlock>): Light['lit'] {
  if (!l) return null;
  const b = blocks.get(l.spec);
  const ps = b && !b.stale ? b.paragraphs : [];
  if (l.kind === 'head') return { spec: l.spec, clauses: new Set(), paragraphs: new Set(), head: true };
  if (l.kind === 'gap') return { spec: l.spec, clauses: new Set(b?.leftOut ?? []), paragraphs: new Set(), head: false };
  if (l.kind === 'paragraph') {
    const i = Number(l.key);
    return { spec: l.spec, clauses: new Set(ps[i]?.cites ?? []), paragraphs: new Set([i]), head: false };
  }
  return { spec: l.spec, clauses: new Set([l.key]), paragraphs: new Set(ps.flatMap((p, i) => (p.cites.includes(l.key) ? [i] : []))), head: false };
}

/** PLAIN-14.5, 14.7: a numbered clause lit by what cites it, and outlined when no paragraph does. */
function sideClass(ctx: Ctx, num: string): string | undefined {
  const side = ctx.side;
  if (!side || !ctx.specId) return undefined;
  const b = side.blocks.get(ctx.specId);
  const lit = side.lit?.spec === ctx.specId && side.lit.clauses.has(num);
  const left = !!b && !b.stale && b.leftOut.includes(num);
  return cn('rounded-sm transition-colors', lit && 'bg-spec/10', left && 'outline-1 outline-offset-4 outline-dashed outline-muted-foreground');
}

/** PLAIN-14.7: hovering a clause lights the paragraphs that cite it. */
function litHandlers(ctx: Ctx, num: string) {
  const side = ctx.side;
  const spec = ctx.specId;
  if (!side || !spec) return {};
  const l: Lit = { spec, kind: 'clause', key: num };
  return { onPointerEnter: () => side.setLit(l), onPointerLeave: () => side.unlit(l) };
}

/** Moves focus to an element just scrolled to, once it's drawn. */
function focusSoon(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  });
}

/** PLAIN-14.8: one row of the two columns: the spec on the left, its simplified side on the right, a line between, 2rem from each. */
function SideRow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[calc(68rem+1px)] grid-cols-[minmax(0,34fr)_1px_minmax(0,30fr)] gap-x-8" data-slot="spec-row">
      <div className="min-w-0 pb-5">{children}</div>
      <div aria-hidden className="bg-border" />
      <div className="min-w-0 pb-5" data-slot="spec-row-side">
        {right}
      </div>
    </div>
  );
}

/** PLAIN-14.8: "On this page" as a menu in the header, while the simplified version takes its place. */
function OutlineMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="quiet" size="default" data-field="spec-outline-menu">
          On this page
          <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[70vh] w-80 overflow-y-auto p-2"
        onClick={(e) => {
          if (e.target instanceof Element && e.target.closest('a')) setOpen(false);
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** TOPIC-11.7's line: who wrote it, with what, for how much, how long ago. */
function writtenBy(kept: PlainSimple, now: number, what: string): string {
  return [`Written by Claude from ${what}`, modelName(kept.model), kept.costUsd === null ? null : formatCost(kept.costUsd), `${formatAge(now - kept.writtenAt)} ago`].filter(Boolean).join(' · ');
}

/** PLAIN-14.11: the simplified column's head: who wrote it, and what was checked. */
function SimpleHead({ kept }: { kept: PlainSimple }) {
  const now = useNow(60_000);
  const jump = useJump();
  const gaps = kept.blocks.filter((b) => !b.stale && b.leftOut.length > 0);
  const ease = kept.readingEase;
  return (
    <section aria-label="Simplified" className="flex flex-col gap-1.5" data-slot="spec-simple-head">
      <h2 className="text-meta font-medium text-muted-foreground">Simplified</h2>
      <p className="text-meta text-muted-foreground" data-field="spec-simple-by">
        {writtenBy(kept, now, kept.specs === 1 ? 'the changed spec' : `the ${kept.specs} changed specs`)}
      </p>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-muted-foreground" data-field="spec-simple-checks">
        <li className="flex items-center gap-1">
          <Check aria-hidden className="size-3.5" />
          Each paragraph cites its clauses
        </li>
        <li className="flex items-center gap-1">
          <Check aria-hidden className="size-3.5" />
          Numbers and quotes kept
        </li>
        {ease !== null &&
          (ease >= 60 ? (
            <li className="flex items-center gap-1">
              <Check aria-hidden className="size-3.5" />
              Reading ease {ease}
            </li>
          ) : (
            <li className="flex items-center gap-1 font-medium text-foreground">
              <CircleAlert aria-hidden className="size-3.5" />
              Reading ease {ease}, harder than it should be
            </li>
          ))}
        {gaps.length > 0 && (
          <li>
            <a href={`#${blockAnchor(gaps[0]!.spec)}`} onClick={jump(blockAnchor(gaps[0]!.spec))} className="flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline" data-field="spec-simple-gaps">
              <CircleAlert aria-hidden className="size-3.5" />
              {gaps.length === 1 ? '1 spec leaves out clauses' : `${gaps.length} specs leave out clauses`}
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

const LEAD_LABEL: Record<NonNullable<PlainSimple['lead']>['lines'][number]['slot'], string> = { changes: 'What changes', who: 'Who gets it', before: 'Unlike before' };

/** PLAIN-14.9: In short: the change in three lines, each citing the specs it comes from. */
function InShort({ lead, kept, ctx, onSimplify, busy }: { lead: NonNullable<PlainSimple['lead']>; kept: PlainSimple; ctx: Ctx; onSimplify(): void; busy: boolean }) {
  const now = useNow(60_000);
  return (
    <section aria-label="In short" className="@container flex flex-col gap-2 rounded-md bg-muted p-3" data-slot="spec-in-short">
      <h3 className="text-body font-semibold">In short</h3>
      {lead.stale ? (
        <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground" data-field="spec-in-short-stale">
          In short is out of date.
          <Button type="button" variant="soft" size="line" onClick={onSimplify} disabled={busy}>
            Simplify again
          </Button>
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-3 gap-y-1 @min-[24rem]:grid-cols-[6.5rem_minmax(0,1fr)] @min-[24rem]:gap-y-2">
          {lead.lines.map((l) => (
            <Fragment key={l.slot}>
              <dt className="text-meta font-medium text-muted-foreground @min-[24rem]:pt-0.5">{LEAD_LABEL[l.slot]}</dt>
              <dd className="text-prose" data-field={`spec-in-short-${l.slot}`}>
                {l.text}
                {l.cites.map((c) => (
                  <LeadCite key={c} cite={c} ctx={ctx} />
                ))}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      <p className="text-meta text-muted-foreground" data-field="spec-in-short-by">
        {writtenBy(kept, now, kept.specs === 1 ? '1 spec' : `${kept.specs} specs`)}
      </p>
    </section>
  );
}

/** PLAIN-14.9: a lead line's spec id, lighting its heading while hovered or focused, and going to it. */
function LeadCite({ cite, ctx }: { cite: string; ctx: Ctx }) {
  const reveal = useContext(Reveal);
  const id = cite.replace(/ notes?$/, '');
  const hold = useHold(ctx.light, { spec: id, kind: 'head', key: '' });
  return <Cite label={cite} name={`Go to ${cite}`} onLit={hold} onClick={() => reveal(specAnchor(id))} />;
}

/** PLAIN-14.6, 14.9: a citation: a clause's number, or a spec's id. The one hand-made button they share. */
function Cite({ label, name, onLit, onClick, expanded }: { label: string; name: string; onLit(on: boolean, how: 'pointer' | 'focus'): void; onClick(): void; expanded?: boolean }) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-expanded={expanded}
      className="ml-1 rounded-sm bg-spec/10 px-1 align-baseline font-mono text-meta font-medium whitespace-nowrap tabular-nums text-spec-text hover:bg-spec/16"
      onPointerEnter={() => onLit(true, 'pointer')}
      onPointerLeave={() => onLit(false, 'pointer')}
      onFocus={() => onLit(true, 'focus')}
      onBlur={() => onLit(false, 'focus')}
      onClick={onClick}
      data-field="spec-cite"
    >
      {label}
    </button>
  );
}

const citeName = (n: string) => (n.startsWith('T') ? `Acceptance test ${n}` : n.startsWith('N') ? `Note ${n}` : `Clause ${n}`);

/**
 * PLAIN-14.7, 14.15: a paragraph's citation. Beside the spec it goes to the clause and focuses it; in
 * place of the spec, where the clause isn't shown, it opens the clauses the paragraph cites.
 */
function ParagraphCite({ spec, n, cites, items, ctx, onLit }: { spec: string; n: string; cites: readonly string[]; items: ReadonlyMap<string, Clause>; ctx: Ctx; onLit(on: boolean, how: 'pointer' | 'focus'): void }) {
  const reveal = useContext(Reveal);
  const [open, setOpen] = useState(false);
  const wide = !!ctx.side?.wide;
  if (wide) {
    return (
      <Cite
        label={n}
        name={citeName(n)}
        onLit={onLit}
        onClick={() => {
          const id = clauseAnchor(spec, n);
          reveal(id);
          focusSoon(id);
        }}
      />
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span>
          <Cite label={n} name={citeName(n)} onLit={noopLit} onClick={() => setOpen(!open)} expanded={open} />
        </span>
      </PopoverAnchor>
      <PopoverContent align="start" className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 p-3" data-slot="spec-cite-card" aria-label={`${spec}, ${cites.length === 1 ? citeName(cites[0]!) : `clauses ${cites.join(', ')}`}`}>
        <p className="font-mono text-meta text-muted-foreground">{spec}</p>
        {cites.map((c) => {
          const clause = items.get(c);
          return clause ? (
            <p key={c} className="flex gap-2 text-prose">
              <span className="w-9 shrink-0 font-mono text-meta tabular-nums text-spec-text">{c}</span>
              <span className="min-w-0">
                <ClauseBody n={clause} ctx={ctx} />
              </span>
            </p>
          ) : null;
        })}
      </PopoverContent>
    </Popover>
  );
}
const noopLit = () => {};

/** PLAIN-14.7: a paragraph's text, its terms underlined, each opening the card its name has, or naming what it stands for; a code span stays code. */
function SimpleText({ text, terms, ctx }: { text: string; terms: readonly { phrase: string; name: string }[]; ctx: Ctx }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
          <code key={i} className="rounded-sm bg-muted px-1 font-mono text-prose">
            {part.slice(1, -1)}
          </code>
        ) : (
          <TermsIn key={i} text={part} terms={terms} ctx={ctx} />
        ),
      )}
    </>
  );
}

function TermsIn({ text, terms, ctx }: { text: string; terms: readonly { phrase: string; name: string }[]; ctx: Ctx }) {
  const found = terms
    .map((t) => ({ t, at: text.indexOf(t.phrase) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const { t, at } of found) {
    if (at < pos) continue;
    out.push(text.slice(pos, at));
    const kind: CardKind | null = ctx.answer.catalogue && ABILITY_KEY.test(t.name) && ctx.answer.abilities?.[t.name] ? 'ability' : ctx.answer.concepts[t.name] ? 'concept' : null;
    out.push(
      kind ? (
        <button key={at} type="button" className="underline decoration-spec decoration-dotted underline-offset-2" aria-haspopup="dialog" data-term="simple" {...cardHandlers(t.name, kind, ctx)}>
          {t.phrase}
        </button>
      ) : (
        <span key={at} className="underline decoration-spec decoration-dotted underline-offset-2" title={t.name} data-term="simple">
          {t.phrase}
        </span>
      ),
    );
    pos = at + t.phrase.length;
  }
  out.push(text.slice(pos));
  return <>{out}</>;
}

/** PLAIN-14.7, 14.8: a paragraph: its text, the numbers it cites, the bar its cited clauses share; hovering it lights them. */
function SimpleParagraph({ spec, p, i, items, ctx }: { spec: string; p: PlainSimpleBlock['paragraphs'][number]; i: number; items: ReadonlyMap<string, Clause>; ctx: Ctx }) {
  const side = ctx.side!;
  const lit = side.lit?.spec === spec && side.lit.paragraphs.has(i);
  const states = new Set(p.cites.map((n) => items.get(n)?.state ?? 'same'));
  const state: Clause['state'] = states.size === 1 ? [...states][0]! : 'changed';
  const bar = ctx.highlight && state !== 'same' ? cn(BAR, BAR_COLOUR[state], 'before:-left-1') : undefined;
  // Lit while the pointer is on it or one of its citations has focus. A citation is inside the paragraph, so
  // its hover is the paragraph's, and only its focus counts.
  const hold = useHold(side, { spec, kind: 'paragraph', key: String(i) });
  const on = (yes: boolean, how: 'pointer' | 'focus') => {
    if (how === 'focus') hold(yes, 'focus');
  };
  const hover = (yes: boolean) => hold(yes, 'pointer');
  return (
    <p className={cn('-mx-2 rounded-md px-2 py-1 transition-colors', bar, lit && 'bg-spec/10')} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)} data-field="spec-simple-p" data-cites={p.cites.join(' ')} data-lit={lit || undefined}>
      <SimpleText text={p.text} terms={p.terms} ctx={ctx} />
      {p.cites.map((n) => (
        <ParagraphCite key={n} spec={spec} n={n} cites={p.cites} items={items} ctx={ctx} onLit={on} />
      ))}
    </p>
  );
}

/** PLAIN-14.4, 14.5, 14.8: a block's body: the spec's example card, its paragraphs, why it couldn't be simplified, what it leaves out. */
function SimpleBody({ spec, block, example, ctx }: { spec: FunctionalSpec; block: PlainSimpleBlock; example: ReactNode; ctx: Ctx }) {
  const items = useMemo(() => new Map(numberSpec(spec).map((x) => [x.n, x.clause])), [spec]);
  return (
    <div id={ctx.side?.wide ? undefined : blockAnchor(spec.id)} className="flex flex-col gap-3" data-slot="spec-simple-body">
      {example}
      {block.paragraphs.length > 0 && (
        <div className="flex flex-col gap-2.5 text-reading">
          {block.paragraphs.map((p, i) => (
            <SimpleParagraph key={i} spec={spec.id} p={p} i={i} items={items} ctx={ctx} />
          ))}
        </div>
      )}
      {block.failed && (
        <p className="text-meta text-muted-foreground" data-field="spec-simple-failed">
          {block.failed}
        </p>
      )}
      {block.leftOut.length > 0 && <LeftOut spec={spec.id} items={block.leftOut} ctx={ctx} />}
    </div>
  );
}

/** PLAIN-14.5: the clauses a block leaves out, by number, with Show them and Simplify again; no Status or Warning colour. */
function LeftOut({ spec, items, ctx }: { spec: string; items: readonly string[]; ctx: Ctx }) {
  const side = ctx.side!;
  const reveal = useContext(Reveal);
  const list = items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items.at(-1)!}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-md bg-muted px-3 py-2 text-body" data-field="spec-simple-left-out">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 basis-48">
        Leaves out {plural(items.length, 'clause', 'clauses')}: {list}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="line"
        onClick={() => {
          side.setLit({ spec, kind: 'gap', key: '' });
          if (!side.wide) side.onShowText(spec, true);
          requestAnimationFrame(() => reveal(clauseAnchor(spec, items[0]!)));
        }}
        data-field="spec-simple-show-gaps"
      >
        Show them
      </Button>
      <Button type="button" variant="quiet" size="line" onClick={side.onSimplify} disabled={side.busy} data-field="spec-simple-again">
        Simplify again
      </Button>
    </div>
  );
}

/** PLAIN-14.12: a changed spec with no fresh simplified version: its spec changed since, or it isn't simplified yet. */
function SimpleMissing({ spec, block, example, ctx }: { spec: FunctionalSpec; block: PlainSimpleBlock | undefined; example: ReactNode; ctx: Ctx }) {
  const side = ctx.side!;
  return (
    <div className="flex flex-col gap-3" data-slot="spec-simple-missing">
      {example}
      <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground" data-field="spec-simple-missing">
        {block?.stale ? `${spec.id} changed since it was simplified.` : 'Not simplified yet.'}
        <Button type="button" variant="soft" size="line" onClick={side.onSimplify} disabled={side.busy}>
          {block?.stale ? 'Simplify again' : 'Simplify'}
        </Button>
      </p>
    </div>
  );
}

/** PLAIN-14.8: a changed spec's simplified block beside its text, sticky while its row scrolls unless it's taller than the view. */
function SimpleBlock({ spec, block, example, ctx }: { spec: FunctionalSpec; block: PlainSimpleBlock | undefined; example: ReactNode; ctx: Ctx }) {
  const side = ctx.side!;
  const ref = useRef<HTMLElement>(null);
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = side.box.current;
    if (!el || !box || typeof ResizeObserver === 'undefined') return;
    const measure = () => setTall(el.offsetHeight > box.clientHeight - STRIP_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, [side.box]);
  const fresh = !!block && !block.stale;
  return (
    <aside ref={ref} id={blockAnchor(spec.id)} aria-label={`${spec.id} simplified`} className={cn('mt-6 flex flex-col gap-3', !tall && 'sticky top-9')} data-slot="spec-simple" data-spec={spec.id} data-sticky={!tall || undefined}>
      <header className="flex flex-col gap-0.5">
        <span className="font-mono text-meta tabular-nums text-muted-foreground">{spec.id} simplified</span>
        {fresh && <h3 className="text-reading-title font-semibold tracking-tight">{block.title ?? specGist(spec)}</h3>}
      </header>
      {fresh ? <SimpleBody spec={spec} block={block} example={example} ctx={ctx} /> : <SimpleMissing spec={spec} block={block} example={example} ctx={ctx} />}
    </aside>
  );
}

