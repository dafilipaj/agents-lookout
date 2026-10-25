import type { ChatEntry, ServerEvent } from '@shared/types.ts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import css from '@/index.css?raw';
import { SessionMarker } from '@/components/ui/session-marker';
import { ClockContext } from '@/lib/time';
import { NOW, fakeResizeObserver, launchView, renderApp, row, rowEl, settings } from '@/test/helpers';

/**
 * The design system's behaviour (DS-9 to DS-11): the Session list takes keyboard focus, a Busy
 * marker pulses only for 10 s after the change, and the terminal preview keeps a height per Session.
 */

const KEY = 'lookout.terminal';
const listbox = () => screen.getByRole('listbox', { name: 'Sessions' });
const path = () => window.location.pathname;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Session list takes keyboard focus (DS-9)', () => {
  it('DS-9.1: the listbox is focusable and names the selected Session’s option, each option with a stable id', () => {
    const app = renderApp('/s/b');
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    expect(listbox()).toHaveAttribute('tabindex', '0');
    expect(listbox()).toHaveAttribute('aria-activedescendant', 'session-b');
    expect(document.getElementById('session-b')).toBe(rowEl('b'));
    expect(rowEl('b')).toHaveAttribute('role', 'option');
    expect(rowEl('a')).toHaveAttribute('id', 'session-a');

    // The id stays with the Session as the list re-sorts.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: NOW })], remove: [] });
    expect(rowEl('a')).toHaveAttribute('id', 'session-a');
    expect(listbox()).toHaveAttribute('aria-activedescendant', 'session-b');
  });

  it('DS-9.1: with nothing selected, a Starting row selected or the selected Session filtered out, it names none', async () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    expect(listbox()).not.toHaveAttribute('aria-activedescendant');
    app.unmount();

    const starting = renderApp('/l/l-1');
    starting.emit({ type: 'snapshot', sessions: [row({ id: 'z' })], fleet: { state: 'ok' }, settings: settings(), launches: [launchView({ id: 'l-1' })], started: [], clientId: 'tab-1', usage: null, memory: null } as ServerEvent);
    expect(document.querySelector('[data-launch-id="l-1"]')).not.toBeNull();
    expect(listbox()).not.toHaveAttribute('aria-activedescendant');
    starting.unmount();

    const user = userEvent.setup();
    const filtered = renderApp('/s/a');
    filtered.snapshot([row({ id: 'a', title: 'alpha' }), row({ id: 'b', title: 'beta' })]);
    await user.type(screen.getByRole('searchbox', { name: 'Filter Sessions' }), 'beta');
    expect(listbox()).not.toHaveAttribute('aria-activedescendant');
  });

  it('DS-9.2: Tab reaches the list after the Filter bar’s buttons and a Starting row’s Dismiss; there ↑/↓, j/k, ⌘1–9 and ⌘J work as before', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.emit({
      type: 'snapshot',
      sessions: [row({ id: 'a', statusSince: NOW - 1000 }), row({ id: 'b', statusSince: NOW - 2000 }), row({ id: 'c', status: 'needs-you', statusSince: NOW - 3000 })],
      fleet: { state: 'ok' },
      settings: settings(),
      launches: [launchView({ id: 'l-1', state: 'failed', error: 'It exited.' })],
      started: [],
      clientId: 'tab-1',
      usage: null, memory: null,
    } as ServerEvent);
    screen.getByRole('searchbox', { name: 'Filter Sessions' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New Session' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName(/Dismiss/);
    await user.tab();
    expect(document.activeElement).toBe(listbox());

    // Screen order: the Starting row, then c (Needs you), a, b (Idle, newest first).
    expect(path()).toBe('/s/a');
    await user.keyboard('{ArrowDown}');
    expect(path()).toBe('/s/b');
    expect(listbox()).toHaveAttribute('aria-activedescendant', 'session-b');
    await user.keyboard('k');
    expect(path()).toBe('/s/a');
    await user.keyboard('j');
    expect(path()).toBe('/s/b');
    await user.keyboard('{ArrowUp}');
    expect(path()).toBe('/s/a');
    await user.keyboard('{Meta>}3{/Meta}'); // the failed start takes no number: c, a, b
    expect(path()).toBe('/s/b');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(path()).toBe('/s/c');
    expect(listbox()).toHaveAttribute('aria-activedescendant', 'session-c');
    // Focus stayed on the list all along.
    expect(document.activeElement).toBe(listbox());
  });

  it('DS-9.2: a ring for keyboard focus only (class contract; jsdom has no :focus-visible); a click focuses the list without one, and the selected row keeps its own ring', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    const list = listbox();
    expect(list).toHaveClass('outline-none', 'focus-visible:ring-2');
    expect([...list.classList].filter((c) => /^focus:/.test(c))).toEqual([]);
    await user.click(within(rowEl('b')).getByText('b'));
    expect(path()).toBe('/s/b');
    expect(document.activeElement).toBe(list);
    expect(rowEl('b')).toHaveClass('ring-1');
    expect(rowEl('a')).not.toHaveClass('ring-1');
  });
});

describe('Busy pulses only when it changed (DS-10)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });
  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const dot = (el: Element) => el.querySelector<SVGElement>('[data-status="busy"] svg')!;

  it('DS-10.1: a sidebar row’s Busy marker pulses for 10 s after the Session became Busy, by the Status’s age, then holds steady', () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'fresh', status: 'busy', statusSince: NOW - 2_000 }), row({ id: 'old', status: 'busy', statusSince: NOW - 60_000 })]);
    // Busy for a minute when the page opened: no pulse.
    expect(dot(rowEl('old'))).not.toHaveClass('animate-busy');
    // Busy for 2 s: pulsing, its animation 2 s in, as if it had run since the change.
    expect(dot(rowEl('fresh'))).toHaveClass('animate-busy');
    expect(dot(rowEl('fresh')).style.animationDelay).toBe('-2000ms');
    // A tick re-renders without restarting or shifting it.
    tick(3_000);
    expect(dot(rowEl('fresh'))).toHaveClass('animate-busy');
    expect(dot(rowEl('fresh')).style.animationDelay).toBe('-2000ms');
    tick(5_000);
    expect(dot(rowEl('fresh'))).not.toHaveClass('animate-busy');
    expect(dot(rowEl('fresh')).style.animationDelay).toBe('');

    // Busy again later: pulses again, from its own start.
    app.emit({ type: 'sessions', upsert: [row({ id: 'old', status: 'idle', statusSince: Date.now() })], remove: [] });
    tick(1_000);
    app.emit({ type: 'sessions', upsert: [row({ id: 'old', status: 'busy', statusSince: Date.now() })], remove: [] });
    expect(dot(rowEl('old'))).toHaveClass('animate-busy');
    expect(dot(rowEl('old')).style.animationDelay).toMatch(/^-?0ms$/);
  });

  it('DS-10.1: the header’s Busy marker and the chat’s "Working…" dot do the same, the dot by the Turn’s start', () => {
    let n = 0;
    const you = (at: number): ChatEntry => ({ kind: 'user', cursor: `c${++n}`, ts: new Date(at).toISOString(), text: 'Go', queued: false });
    const tool = (): ChatEntry => ({ kind: 'tool_call', cursor: `c${++n}`, ts: null, id: `t${n}`, tool: 'Read', summary: 'x' });
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy', statusSince: NOW - 1_000 })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [you(NOW - 4_000), tool()], before: null, queue: [] });
    const header = screen.getByRole('banner', { name: 'Session' });
    const chatDot = () => screen.getByTestId('chat-activity').querySelector<HTMLElement>('[aria-hidden] > span')!;
    expect(dot(header)).toHaveClass('animate-busy');
    expect(dot(header).style.animationDelay).toBe('-1000ms');
    expect(chatDot()).toHaveClass('animate-busy', 'bg-busy');
    expect(chatDot().style.animationDelay).toBe('-4000ms');
    tick(6_000); // the Turn is 10 s old, the Status 7 s
    expect(chatDot()).not.toHaveClass('animate-busy');
    expect(dot(header)).toHaveClass('animate-busy');
    tick(3_000);
    expect(dot(header)).not.toHaveClass('animate-busy');
    expect(chatDot()).toHaveClass('bg-busy'); // still Working, steady
  });

  it('DS-10.1: History’s and Work’s Session marker take the Status’s start too; without one it holds steady', () => {
    const at = (now: number, since: number | null) =>
      render(
        <ClockContext.Provider value={now}>
          <SessionMarker state="live" status="busy" since={since} />
        </ClockContext.Provider>,
      ).container;
    expect(dot(at(NOW, NOW - 9_000))).toHaveClass('animate-busy');
    expect(dot(at(NOW, NOW - 10_000))).not.toHaveClass('animate-busy');
    expect(dot(at(NOW, null))).not.toHaveClass('animate-busy');
    // Only Busy pulses.
    const idle = render(
      <ClockContext.Provider value={NOW}>
        <SessionMarker state="live" status="idle" since={NOW} />
      </ClockContext.Provider>,
    ).container;
    expect(idle.querySelector('.animate-busy')).toBeNull();
  });

  it('DS-10.1: two markers of one Session pulse in step: the delay is the real age when each mounts, not the clock’s last second', () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a', status: 'busy', statusSince: NOW - 2_000 })]);
    const header = () => screen.getByRole('banner', { name: 'Session' });
    expect(dot(rowEl('a')).style.animationDelay).toBe('-2000ms');
    // 600 ms later, before the clock's next tick, the row is opened: its header's dot joins the pulse at the same phase.
    vi.setSystemTime(NOW + 600);
    fireEvent.click(within(rowEl('a')).getByText('a'));
    expect(dot(header()).style.animationDelay).toBe('-2600ms');
  });

  it('DS-10.1: with reduced motion nothing pulses: `animate-busy` animates only under prefers-reduced-motion: no-preference', () => {
    const rules = [...css.matchAll(/\.animate-busy\s*\{[^}]*\}/g)];
    expect(rules).toHaveLength(1);
    const before = css.slice(0, rules[0]!.index);
    const media = before.lastIndexOf('@media');
    expect(before.slice(media)).toMatch(/^@media \(prefers-reduced-motion: no-preference\)\s*\{\s*$/);
  });
});

describe('terminal preview height (DS-11)', () => {
  const preview = () => screen.getByRole('region', { name: 'Terminal preview' });
  const handle = () => screen.getByRole('separator', { name: 'Terminal preview height' });
  const shown = () => Number.parseInt(preview().style.height, 10);
  const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
  /** jsdom lays nothing out: give the main pane (any view, as a Session's view mounts anew) a height, and tell its observer. */
  let paneHeight = 0;
  let contentHeight = 0;
  beforeEach(() => {
    paneHeight = 0;
    contentHeight = 0;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-shell-view')) return paneHeight;
      return this.getAttribute('data-shell-row') === 'body' ? contentHeight : 0;
    });
  });
  afterEach(() => vi.restoreAllMocks());
  function paneOf(ro: ReturnType<typeof fakeResizeObserver>, height: number) {
    paneHeight = height;
    ro.resize(preview().closest<HTMLElement>('[data-shell-view]')!);
  }
  /** The content row (the chat and the preview share it), told to its observer. */
  function contentOf(ro: ReturnType<typeof fakeResizeObserver>, height: number) {
    contentHeight = height;
    ro.resize(preview().closest<HTMLElement>('[data-shell-row="body"]')!);
  }

  it('DS-11.1: the preview opens at the height kept for its Session; with none, at 285 px or 35% of the main pane, whichever is smaller', () => {
    const ro = fakeResizeObserver();
    window.localStorage.setItem(KEY, JSON.stringify({ kept: 300 }));
    const app = renderApp('/s/kept');
    app.snapshot([row({ id: 'kept', status: 'needs-you' }), row({ id: 'fresh', status: 'needs-you' })]);
    paneOf(ro, 1000);
    expect(shown()).toBe(300);
    app.unmount();

    const other = renderApp('/s/fresh');
    other.snapshot([row({ id: 'kept', status: 'needs-you' }), row({ id: 'fresh', status: 'needs-you' })]);
    paneOf(ro, 1000);
    expect(shown()).toBe(285);
    paneOf(ro, 600);
    expect(shown()).toBe(210);
  });

  it('DS-11.2: the top edge is a separator handle with its height as its value: ↑/↓ move it by 16 px, a drag resizes it, both within its bounds', () => {
    const ro = fakeResizeObserver();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you', statusSince: NOW - 1000 }), row({ id: 'b', statusSince: NOW - 2000 })]);
    paneOf(ro, 1000);
    const h = handle();
    expect(preview().firstElementChild).toBe(h); // above the Terminal row
    expect(h).toHaveAttribute('aria-orientation', 'horizontal');
    expect(h).toHaveAttribute('tabindex', '0');
    expect(h).toHaveAttribute('aria-valuenow', '285');
    expect(h).toHaveAttribute('aria-valuemin', '115');
    expect(h).toHaveAttribute('aria-valuemax', '700');
    expect(h).toHaveClass('cursor-row-resize');

    h.focus();
    fireEvent.keyDown(h, { key: 'ArrowUp' });
    expect(handle()).toHaveAttribute('aria-valuenow', '301');
    expect(shown()).toBe(301);
    fireEvent.keyDown(h, { key: 'ArrowDown' });
    fireEvent.keyDown(h, { key: 'ArrowDown' });
    expect(shown()).toBe(269);
    // The keys are the handle's, not the Session sidebar's (SIDE-5).
    expect(path()).toBe('/s/a');

    fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 400 });
    expect(shown()).toBe(369);
    expect(handle()).toHaveAttribute('data-dragging');
    fireEvent.pointerMove(h, { pointerId: 1, clientY: -2000 });
    expect(shown()).toBe(700); // 70% of the pane
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 2000 });
    expect(shown()).toBe(115); // the Terminal row and four lines
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 450 });
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 450 });
    expect(shown()).toBe(319);
    expect(stored()).toEqual({ a: 319 });
    expect(handle()).not.toHaveAttribute('data-dragging');
  });

  it('DS-11.3: kept per Session; resizing one leaves another’s alone; a kept height too tall for the window shows clamped and stays kept; the preview still gives way before the chat', async () => {
    const ro = fakeResizeObserver();
    const user = userEvent.setup();
    window.localStorage.setItem(KEY, JSON.stringify({ b: 600 }));
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you', statusSince: NOW - 1000 }), row({ id: 'b', status: 'needs-you', statusSince: NOW - 2000 })]);
    paneOf(ro, 1000);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(stored()).toEqual({ a: 301, b: 600 });

    await user.click(within(rowEl('b')).getByText('b'));
    expect(shown()).toBe(600);
    paneOf(ro, 700); // a shorter window: 70% is 490
    expect(shown()).toBe(490);
    expect(stored()).toEqual({ a: 301, b: 600 });
    paneOf(ro, 1000);
    expect(shown()).toBe(600);

    await user.click(within(rowEl('a')).getByText('a'));
    expect(shown()).toBe(301);

    // SIDE-8.1 (class contract; jsdom can't measure): the preview may shrink to its Terminal row, the
    // chat keeps its 96 px.
    expect(preview()).toHaveClass('min-h-0');
    expect(preview()).not.toHaveClass('shrink-0');
    expect(within(preview()).getByRole('button', { name: /Terminal/ })).toHaveClass('shrink-0');
    expect(screen.getByTestId('terminal-preview')).toHaveClass('min-h-0', 'flex-1');
    expect(screen.getByTestId('chat').parentElement).toHaveClass('min-h-24', 'flex-1');
  });

  it('DS-11.2: the value and a drag start are the height the preview really has: the content row less the chat’s 96 px caps it, on a short window or with a tall dock', () => {
    const ro = fakeResizeObserver();
    window.localStorage.setItem(KEY, JSON.stringify({ a: 630 }));
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you' })]);
    paneOf(ro, 900);
    expect(shown()).toBe(630); // 70% of 900; the content row isn't measured yet
    contentOf(ro, 500); // a tall dock took the rest: 500 − 96 leaves 404
    expect(shown()).toBe(404);
    expect(handle()).toHaveAttribute('aria-valuenow', '404');
    expect(handle()).toHaveAttribute('aria-valuemax', '404');
    expect(stored()).toEqual({ a: 630 }); // kept as it was
    // ↑ is already at the top; ↓ moves from what's shown, not from 630.
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(shown()).toBe(388);
    // A drag starts from what's shown too: up 20 px reaches the cap and stops, down 20 px from 388 shrinks it at once.
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 480 });
    expect(shown()).toBe(404);
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 520 });
    expect(shown()).toBe(368);
    fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 520 });
    // The dock shrinks again: the room is back.
    contentOf(ro, 800);
    expect(shown()).toBe(368);
  });

  it('DS-11.2: a drag that is cancelled goes back to where it began', () => {
    const ro = fakeResizeObserver();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you' })]);
    paneOf(ro, 1000);
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 400 });
    expect(shown()).toBe(385);
    fireEvent.pointerCancel(handle(), { pointerId: 1 });
    expect(shown()).toBe(285);
    expect(stored()).toBeNull();
  });

  it('DS-11.3: a Codex Session’s height follows it when it gets its session id', () => {
    const ro = fakeResizeObserver();
    window.localStorage.setItem(KEY, JSON.stringify({ 'codex:42': 330, other: 200 }));
    const app = renderApp('/s/codex:42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex', status: 'needs-you' }), row({ id: 'other', pid: 7 })]);
    paneOf(ro, 1000);
    expect(shown()).toBe(330);
    app.emit({ type: 'sessions', upsert: [row({ id: 'thread-1', pid: 42, harness: 'codex', status: 'needs-you' })], remove: ['codex:42'] });
    expect(path()).toBe('/s/thread-1');
    expect(stored()).toEqual({ 'thread-1': 330, other: 200 });
    paneOf(ro, 1000);
    expect(shown()).toBe(330);
  });

  it('DS-11.5: with storage blocked or full the handle still resizes for the page’s life; it just isn’t kept', () => {
    const ro = fakeResizeObserver();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you' }), row({ id: 'b', status: 'needs-you' })]);
    paneOf(ro, 1000);
    expect(shown()).toBe(285);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(shown()).toBe(301);
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 450 });
    fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 450 });
    expect(shown()).toBe(351); // it doesn't snap back on release
    vi.restoreAllMocks();
    expect(window.localStorage.getItem(KEY)).toBeNull(); // nothing was stored
    // Storage works again: the next keep goes through, carrying this page's height with it.
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(stored()).toEqual({ a: 367 });
  });

  it('DS-11.5: heights for Sessions no longer listed go once the list is known; junk in storage is the default, without an error', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 300, gone: 200 }));
    const app = renderApp('/s/a');
    // Before the list is known, nothing is pruned.
    expect(stored()).toEqual({ a: 300, gone: 200 });
    app.snapshot([row({ id: 'a', status: 'needs-you' })]);
    expect(stored()).toEqual({ a: 300 });
    app.emit({ type: 'sessions', upsert: [row({ id: 'b', pid: 200 })], remove: ['a'] });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    app.unmount();

    window.localStorage.setItem(KEY, '{not json');
    const errors = vi.spyOn(console, 'error');
    const junk = renderApp('/s/a');
    junk.snapshot([row({ id: 'a', status: 'needs-you' })]);
    expect(shown()).toBe(269); // jsdom's 768 px window: 35% is 268.8
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
