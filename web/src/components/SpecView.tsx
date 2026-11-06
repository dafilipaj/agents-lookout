import { ABILITY_KEY, compareClauses, compareModules, definitionName, gist, parseClauses, PREDEFINED_CONCEPTS, wordDiff, type AbilityEntry, type AbilityLeafKind, type AbilityRule, type Clause, type Compared, type FunctionalSpec, type PlainAbility, type PlainAnswer, type PlainConcept, type PlainSource, type PlainSpecRef, type Touched } from '@shared/plain.ts';
import { ArrowLeft, ChevronDown, ChevronRight, ChevronUp, ListChecks } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Button, ButtonDivider } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Segmented, type SegmentedChoice } from '@/components/ui/segmented';
import { SaveError } from '@/lib/client';
import { type ChangeKind, firstLine, JUMP_MARGIN_PX, type Mark, stepMark } from '@/lib/marks';
import { plainRoute, routePath, specHash } from '@/lib/router';
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
export function SpecView({ source, path, backTo, load, setViewed, onBack, onOpenModule }: SpecViewProps) {
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
  // PLAIN-10.3: a Module with no change is Clean, with no switch; a change arriving later keeps you on Clean.
  if (answer && compared && !hasChange && chosen !== 'clean') setChosen('clean');
  const deleted = answer?.text === null;
  // PLAIN-10.2: a Module with a change opens on Changes; a deleted one can't be Clean (PLAIN-10.3).
  const view: SpecMode = !hasChange ? 'clean' : chosen === null || (deleted && chosen === 'clean') ? 'changes' : chosen;
  const highlight = view !== 'clean';
  useEffect(() => {
    if (answer) viewByEntry.set(entryId(), view);
  }, [answer, view]);


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
      flushSync(() => setChosen(viewByEntry.get(next) ?? null));
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
  }, [highlight, view, answer, compared, folds, opened]);

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
    return marksRef.current.map((m) => (scroller.current?.querySelector(`[data-mark="${m.cursor}"]`)?.getBoundingClientRect().top ?? 0) - base);
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
    [],
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
  const ctx: Ctx = { own, specIds, specById, answer, justChanged, highlight, fold, onTerm, onFold, hrefOf, onOpenModule };
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
      className="flex shrink-0 flex-col gap-0.5 text-meta @min-[640px]:sticky @min-[640px]:top-0 @min-[640px]:col-start-3 @min-[640px]:row-start-1 @min-[640px]:max-h-[calc(100dvh-6rem)] @min-[640px]:self-start @min-[640px]:overflow-y-auto @min-[640px]:pl-8"
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
                <span className="line-clamp-2 min-w-0 flex-1">{s.clauses[0] ? gist(s.clauses[0].text) : ''}</span>
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

  return (
    <div
      // PLAIN-8.1: the column is the chat's width, centred while the outline fits on its right; with less room it moves left, then narrows.
      className="flex min-w-0 flex-col gap-4 @min-[640px]:grid @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,48rem)_minmax(15rem,1fr)] @min-[640px]:items-start @min-[640px]:gap-0"
      data-view={view}
      data-slot="spec-layout"
    >
      {nav}
      {/* PLAIN-8.1: a long code span or word wraps, so nothing widens the pane. */}
      {/* PLAIN-9.1: at most 42rem, about 85 characters a line, from the column's left edge. */}
      <article className="flex w-full min-w-0 max-w-[42rem] flex-col gap-5 [overflow-wrap:anywhere] @min-[640px]:col-start-2 @min-[640px]:row-start-1" data-slot="spec-module">
        <SpecStrip spec={stuck ? mod.specs.find((s) => s.id === stuck) : undefined} highlight={highlight} />
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
        </header>

        {answer.fetchError && <Alert tone="info" title={`Showing ${answer.checkout.where ?? 'the PR'} as fetched before`} detail={answer.fetchError} data-field="spec-fetch-error" />}

        {answer.changedSinceViewed && !answer.viewed && <Alert tone="info" title="Changed since you viewed it" data-field="spec-changed-since" />}

        {showCard && (
          <section id="changes" aria-label="Changes" className="flex flex-col gap-2 rounded-md border border-border p-3" data-slot="spec-changes" data-outline>
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
                    <span className="truncate">{r.gist}</span>
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
          </section>
        )}

        {mod.notes.length > 0 && (
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
          </Folded>
        )}

        {sectionKeys.map((k) => (
          <section key={k} id={sectionId(k)} aria-label={SECTION_TITLES[k] ?? k} className="flex flex-col gap-2" data-touched={touched.has(k) || undefined} data-outline data-where={SECTION_TITLES[k] ?? k}>
            <SectionTitle title={SECTION_TITLES[k] ?? k} count={(mod.sections[k] ?? []).filter((n) => n.state !== 'removed').length} />
            {k === 'definitions' ? <Definitions nodes={mod.sections[k] ?? []} ctx={ctx} /> : <ClauseList nodes={mod.sections[k] ?? []} ctx={ctx} inset={0} scope={k} />}
            {mod.sectionNotes[k] && <Notes nodes={mod.sectionNotes[k]} ctx={ctx} scope={`${k} notes`} />}
          </section>
        ))}

        {hasSpecs && (
          <section id={sectionId('functional specs')} aria-label="Functional specs" className="flex flex-col gap-3" data-touched={touched.has('functional specs') || undefined} data-outline data-where="Functional specs">
            <SectionTitle title="Functional specs" count={live.length} />
            {mod.sectionNotes['functional specs'] && <Notes nodes={mod.sectionNotes['functional specs']} ctx={ctx} scope="functional specs notes" />}
            <SpecList specs={specs} ctx={ctx} />
          </section>
        )}

        {mod.loose.length > 0 && (
          <section aria-label="Not in a section" className="flex flex-col gap-2" data-slot="spec-loose">
            <SectionTitle title="Not in a section" count={mod.loose.length} />
            <Folded ctx={ctx} keep={newOrGone} scope="loose" items={mod.loose} label={plural(mod.loose.length, 'line', 'lines')}>
              {(run) => (
                <pre className="whitespace-pre-wrap font-mono text-meta text-muted-foreground" data-run={run}>
                  {mod.loose.join('\n')}
                </pre>
              )}
            </Folded>
          </section>
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
): { className?: string; style?: CSSProperties; 'data-change'?: string; 'data-change-text'?: string } {
  if (!highlight || state === 'same') return {};
  const gutter = bulleted && inset !== undefined;
  return {
    // A bulleted clause's bar sits left of its bullet.
    className: cn(BAR, BAR_COLOUR[state], bulleted && 'before:-left-6', gutter && 'before:left-(--bar-x)'),
    ...(gutter ? { style: { '--bar-x': `-${inset + INDENT_REM + GUTTER_REM}rem` } as CSSProperties } : {}),
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
  const rows = new Map<string, { where: string; label: string; gist: string; added: number; changed: number; removed: number; newSpec: boolean; removedSpec: boolean; tests: boolean; notes: boolean }>();
  for (const t of touched) {
    const where = t.where.replace(/ (tests|notes)$/, '');
    let r = rows.get(where);
    if (!r) {
      const spec = specs.find((s) => s.id === where);
      const label = spec ? where : where === 'description' ? 'Description' : (SECTION_TITLES[where] ?? (where === 'functional specs' ? 'Functional specs' : where));
      r = { where, label, gist: spec?.clauses[0] ? gist(spec.clauses[0].text) : '', added: 0, changed: 0, removed: 0, newSpec: false, removedSpec: false, tests: false, notes: false };
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
        if (part.kind === 'fold') return <FoldLine key={`fold-${part.key}`} runKey={part.key} ctx={ctx} label={plural(part.items.length, 'unchanged note', 'unchanged notes')} />;
        const n = part.item;
        return (
          <p key={`${part.at}-${n.text.slice(0, 40)}`} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined} data-run={part.opens} {...changeProps(n.state, ctx.highlight, n.text)}>
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
  return (
    <ul className={cn('flex list-disc flex-col pl-5 marker:text-muted-foreground', reading ? 'gap-2 text-reading' : 'gap-1 text-prose', className)}>
      {parts.map((part) => {
        if (part.kind === 'fold') {
          return (
            <li key={`fold-${part.key}`} className="list-none">
              <FoldLine runKey={part.key} ctx={ctx} label={plural(part.items.length, ...noun)} />
            </li>
          );
        }
        const n = part.item;
        const c = part.whole ? whole(ctx) : ctx;
        return (
          <li key={`${part.at}-${n.text.slice(0, 40)}`} data-state={n.state} data-just-changed={ctx.justChanged.has(n.text) || undefined} data-run={part.opens}>
            <div {...changeProps(n.state, ctx.highlight, n.text, true, inset)}>
              <span className={stateClass(n.state, ctx, n.text)}>
                <Tag state={n.state} ctx={ctx} />
                <ClauseBody n={n} ctx={ctx} />
              </span>
            </div>
            {n.children.length > 0 && <ClauseList nodes={n.children} ctx={c} className={reading ? 'mt-2' : 'mt-1'} inset={reading ? inset + INDENT_REM : undefined} scope={`${scope}>${n.text}`} />}
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
  return foldRuns(specs, ctx.fold, 'specs', specTouched, (s) => s.id).map((part) =>
    part.kind === 'fold' ? (
      <FoldLine
        key={`fold-${part.key}`}
        runKey={part.key}
        ctx={ctx}
        holds={part.items.map((s) => specAnchor(s.id))}
        label={`${plural(part.items.length, 'unchanged spec', 'unchanged specs')}, ${part.items[0]!.id}${part.items.length > 1 ? ` to ${part.items.at(-1)!.id}` : ''}`}
        className="mt-6"
      />
    ) : (
      <Spec key={part.item.id} spec={part.item} ctx={part.whole ? whole(ctx) : ctx} run={part.opens} />
    ),
  );
}

/** PLAIN-9.2 to 9.6: a functional spec: its heading, its clauses, its acceptance tests in a box, its notes behind a button. */
function Spec({ spec, ctx, run }: { spec: FunctionalSpec; ctx: Ctx; run?: string }) {
  const tests = spec.tests.filter((n) => there(n, ctx));
  // PLAIN-10.5: in Changes, a spec's acceptance tests with no change fold into one line in place of their box.
  const testsKey = ctx.fold && !hasChange(spec.tests) ? runKey(`${spec.id} tests`, tests.map((n) => n.text)) : null;
  const testsFolded = testsKey !== null && !ctx.fold!.opened.has(testsKey);
  return (
    <article id={specAnchor(spec.id)} aria-label={spec.id} data-state={spec.state} className="mt-6 flex flex-col gap-3" data-outline data-where={spec.id} data-spec-id={spec.id} data-run={run}>
      {/* PLAIN-9.2: the id hangs in the margin when the pane has room for it, else it sits above the heading. */}
      <header className="relative flex flex-col gap-0.5" data-spec-head>
        <span className="font-mono text-meta tabular-nums text-muted-foreground @min-[73rem]:absolute @min-[73rem]:top-1.5 @min-[73rem]:right-full @min-[73rem]:mr-6 @min-[73rem]:whitespace-nowrap" data-field="spec-id">
          {spec.id}
        </span>
        <h3 className="text-reading-title font-semibold tracking-tight">{specGist(spec)}</h3>
        <SpecChange spec={spec} highlight={ctx.highlight} className="text-meta" />
      </header>
      <ClauseList nodes={spec.clauses} ctx={ctx} inset={0} scope={spec.id} />
      {tests.length > 0 &&
        (testsFolded ? (
          <FoldLine runKey={testsKey} ctx={ctx} label={plural(tests.length, 'unchanged acceptance test', 'unchanged acceptance tests')} />
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
    </article>
  );
}

/**
 * PLAIN-9.5: a spec's notes behind a button: open when one of them changed, then as you leave them.
 * In Changes, a spec none of whose notes changed has no button: its notes fold into a line (PLAIN-10.5).
 */
function SpecNotes({ notes, ctx, scope }: { notes: readonly Clause[]; ctx: Ctx; scope: string }) {
  // In Clean nothing is marked, so they open as an unchanged spec's do (PLAIN-10.4).
  const changed = ctx.highlight && hasChange(notes);
  const [open, setOpen] = useState<boolean | null>(null);
  if (ctx.fold && !changed) return <Notes nodes={notes} ctx={ctx} scope={scope} />;
  const isOpen = open ?? changed;
  const count = notes.filter((n) => n.state !== 'removed').length;
  if (!count && !ctx.highlight) return null;
  return (
    <div className="flex flex-col gap-1.5" data-slot="spec-notes-fold">
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
function SpecStrip({ spec, highlight }: { spec: FunctionalSpec | undefined; highlight: boolean }) {
  const jump = useJump();
  return (
    <div className="sticky top-0 z-10 h-0" data-slot="spec-strip">
      {spec && (
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
