import type { LocalServer, PortsSnapshot } from '@shared/ports.ts';
import type { EvidenceView } from '@shared/evidence.ts';
import { verdict } from '@shared/evidence.ts';
import type { ChangesView, SessionRow, SubagentItem } from '@shared/types.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeResizeObserver, renderApp, row } from '@/test/helpers';

/**
 * VIEW-5.19 in the view: jsdom lays nothing out, so each part's width is stubbed by its `data-part`, as
 * if 7 px a character, with no gaps; the line's width is `room`, changed by a resize.
 */
const W: Record<string, number> = { repo: 28, changes: 77, files: 70, evidence: 151, servers: 81, more: 60, subagents: 77, model: 82, effort: 40, context: 137, note: 140 };
const NAME = 77; // 'fx-rounding', 11 characters; its icon and gap 18 more
let room = 1000;

const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const onLine = () => [...statusLine().querySelectorAll('[data-part]')].map((e) => e.getAttribute('data-part'));
const more = () => within(statusLine()).queryByRole('button', { name: / more: / });
const list = () => document.querySelector<HTMLElement>('[data-slot="status-more"]');
const rowNames = () => [...list()!.querySelectorAll('[data-part-row]')].map((r) => r.querySelector('[data-slot="part-name"]')!.textContent);

const item = (id: string): SubagentItem => ({ id, parent: null, depth: 1, state: 'running', task: `Task ${id}`, type: 'general-purpose', name: null, role: null, model: 'claude-opus-5-5', startedAt: new Date(NOW).toISOString(), endedAt: null, activity: null });
const SERVER: LocalServer = { pid: 601, ports: [5173], command: 'vite', name: 'web', cwd: '/Users/me/Projects/work', dir: 'work', repo: { name: 'work', commonDir: '/Users/me/Projects/work/.git' }, startedAt: NOW - 60_000, sessionId: 'a', by: 'tree', url: 'http://localhost:5173', devctl: false, lookout: false, shown: true };
const ports = (servers: LocalServer[]): PortsSnapshot => ({ servers, readAt: NOW, error: null });
const EVIDENCE: EvidenceView = {
  sessionId: 'a',
  verdict: verdict('changed'),
  readAt: NOW,
  error: null,
  lastChange: NOW,
  lastPass: { end: NOW - 60_000, passed: 12 },
  runCount: 1,
  changedSince: 0,
  documentsSince: 0,
  changedSinceFiles: [],
  testFiles: { count: 1, added: 0, deleted: 0, additions: 4, deletions: 1 },
  changedFiles: 23,
  listedFiles: 23,
  runs: [],
  rounds: [],
  changedSinceReview: 0,
};

/** The status line Artifact's "Idle, everything on": Changes, a warning verdict, a Local server, Compact and two Subagents running. */
const session = (over: Partial<SessionRow> = {}) =>
  row({
    id: 'a',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    contextPct: 47,
    changes: { additions: 1412, deletions: 212, files: 23 },
    evidence: verdict('changed'),
    subagents: { running: 2, finished: 0, items: [item('s1'), item('s2')] },
    git: { repo: 'work', worktree: 'fx-rounding', branch: 'fix/fx-rounding', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' },
    ...over,
  });

let ro: ReturnType<typeof fakeResizeObserver>;
beforeEach(() => {
  room = 1000;
  ro = fakeResizeObserver();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    const part = this.dataset.part;
    if (part === 'location') return 18 + NAME;
    if (part) return (W[part] ?? 0) + (this.querySelector('[data-subpart="files"]') ? W.files! : 0) + (this.querySelector('[data-subpart="note"]') ? W.note! : 0);
    if (this.dataset.subpart === 'location-name') return NAME;
    if (this.dataset.subpart) return W[this.dataset.subpart] ?? 0;
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.subpart === 'location-name' ? NAME : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-label') === 'Status line' ? room : 0;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function show(over: Partial<SessionRow> = {}) {
  const app = renderApp('/s/a');
  app.snapshot([session(over)]);
  app.emit({ type: 'evidence', sessionId: 'a', evidence: EVIDENCE });
  app.emit({ type: 'ports', ports: ports([SERVER]) });
  // The model's label: the list is read once a view shows a model.
  await waitFor(() => expect(within(statusLine()).getByRole('button', { name: /^Model: / })).toHaveTextContent('Sonnet 5.5'));
  return app;
}
const resize = (to: number) => {
  room = to;
  ro.resize(statusLine());
};

describe('the status line folds parts whole into "N more" (VIEW-5.19)', () => {
  it('VIEW-5.19: as the line narrows, parts leave whole by rank: the repo and the files count silently, then into "N more" at the seam', async () => {
    await show();
    expect(onLine()).toEqual(['repo', 'location', 'changes', 'evidence', 'servers', 'subagents', 'model', 'effort', 'context']);
    expect(more()).toBeNull();
    expect(statusLine().querySelector('[data-field="changes"]')).toHaveTextContent('+1.4k−212· 23 files');

    // 817 px of parts, with the location at its least: the repo leaves first, silently.
    resize(816);
    expect(onLine()).toEqual(['location', 'changes', 'evidence', 'servers', 'subagents', 'model', 'effort', 'context']);
    expect(more()).toBeNull();
    // The location's tooltip names the repo.
    expect(statusLine().querySelector('[data-field="location"]')).toHaveAttribute('title', 'work · Worktree fx-rounding (branch fix/fx-rounding)');

    // Then the number of files, silently: the count's tooltip has it.
    resize(780);
    expect(statusLine().querySelector('[data-field="changes"]')).toHaveTextContent(/^\+1\.4k−212$/);
    expect(statusLine().querySelector('[data-field="changes"]')).toHaveAttribute('title', '1412 lines added, 212 removed in 23 files');
    expect(more()).toBeNull();

    // The Effort alone frees less than "N more" takes, so the servers leave with it.
    resize(700);
    expect(onLine()).toEqual(['location', 'changes', 'evidence', 'more', 'subagents', 'model', 'context']);
    expect(more()).toHaveTextContent(/^2 more$/);
    expect(more()).toHaveAccessibleName('2 more: Local servers, Effort');

    resize(450);
    expect(onLine()).toEqual(['location', 'more', 'subagents', 'context']);
    expect(more()).toHaveTextContent(/^5 more$/);
    // Narrower than everything can be: every part that can leave has; the location, the context and "N more" stay.
    resize(200);
    expect(onLine()).toEqual(['location', 'more', 'context']);
    expect(more()).toHaveTextContent(/^6 more$/);

    // Room again: they come back.
    resize(1000);
    expect(onLine()).toEqual(['repo', 'location', 'changes', 'evidence', 'servers', 'subagents', 'model', 'effort', 'context']);
    expect(more()).toBeNull();
  });

  it('VIEW-5.19: "N more" opens upward a row per folded part in the line\'s order, each doing what a click on the part does', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const app = await show();
    const user = userEvent.setup();
    resize(450);
    await user.click(more()!);
    expect(list()).toHaveAttribute('data-side', 'top');
    expect(rowNames()).toEqual(['Changes', 'Evidence', 'Local server', 'Model', 'Effort']);
    const rowOf = (name: string) => [...list()!.querySelectorAll<HTMLElement>('[data-part-row]')].find((r) => r.querySelector('[data-slot="part-name"]')!.textContent === name)!;
    expect(rowOf('Model').querySelector('[data-slot="part-value"]')).toHaveTextContent('Sonnet 5.5');
    expect(rowOf('Changes').querySelector('[data-slot="part-value"]')).toHaveTextContent('+1.4k−212 · 23 files');

    // The model's menu, from its row.
    await user.click(rowOf('Model'));
    expect(screen.getByRole('menu', { name: /^Model: / })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(list()).toBeTruthy();

    // The Effort's.
    await user.click(rowOf('Effort'));
    expect(screen.getByRole('menu', { name: /^Effort: / })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // The changed-files list.
    await user.click(rowOf('Changes'));
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toBeTruthy());
    expect(app.client.watchChanges).toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toBeNull());

    // The Evidence popover.
    await user.click(rowOf('Evidence'));
    await waitFor(() => expect(document.querySelector('[data-slot="evidence"]')).toBeTruthy());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[data-slot="evidence"]')).toBeNull());

    // One Local server opens in the browser.
    await user.click(rowOf('Local server'));
    expect(open).toHaveBeenCalledWith('http://localhost:5173', '_blank', 'noopener,noreferrer');
  });

  it('VIEW-5.19: the Subagents fold last, their row opening their list; a queued job and a background shell are rows that open nothing', async () => {
    await show({ queued: { tool: 'vitest', since: NOW - 120_000, position: 1 }, backgroundShell: true });
    const user = userEvent.setup();
    resize(100);
    await user.click(more()!);
    expect(rowNames()).toEqual(['Changes', 'Evidence', 'Queued', 'Local server', 'Subagents', 'Background shell', 'Model', 'Effort']);
    const rows = [...list()!.querySelectorAll<HTMLElement>('[data-part-row]')];
    expect(rows[2]!.tagName).toBe('DIV');
    expect(rows[2]).toHaveAttribute('title', expect.stringMatching(/^Queued in res: vitest/));
    expect(rows[5]!.tagName).toBe('DIV');
    expect(rows[5]).toHaveAttribute('title', 'A background shell command is still running');
    await user.click(rows[4]!);
    expect(screen.getByRole('group', { name: 'Subagents' })).toBeInTheDocument();
  });

  it('VIEW-5.19: the list works from the keyboard: Enter opens it, Up and Down move, Enter opens a row\'s menu, Esc closes the topmost and returns focus', async () => {
    await show();
    const user = userEvent.setup();
    resize(600);
    more()!.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(list()).toBeTruthy());
    expect(rowNames()).toEqual(['Local server', 'Model', 'Effort']);
    const rows = () => [...list()!.querySelectorAll<HTMLElement>('[data-part-row]')];
    await waitFor(() => expect(document.activeElement).toBe(rows()[0]));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows()[1]);
    // Down moves on from a menu's row too; Up comes back.
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows()[2]);
    expect(screen.queryByRole('menu')).toBeNull();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu', { name: /^Model: / })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(rows()[1]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(list()).toBeNull());
    expect(document.activeElement).toBe(more());
  });

  it('VIEW-5.19: nothing folds or comes back while a list is open; when its last part goes, "N more" closes and focus returns to the composer', async () => {
    const app = await show();
    const user = userEvent.setup();
    resize(600);
    await user.click(more()!);
    expect(more()).toHaveTextContent('3 more');
    // Narrower while it's open: nothing moves.
    resize(450);
    expect(more()).toHaveTextContent('3 more');
    expect(onLine()).toContain('evidence');
    // Closed, the line folds for its width.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(list()).toBeNull());
    resize(450);
    expect(more()).toHaveTextContent('5 more');

    // Its folded parts go while it's open: it closes, and focus goes to the composer.
    resize(700);
    await user.click(more()!);
    expect(rowNames()).toEqual(['Local server', 'Effort']);
    app.emit({ type: 'ports', ports: ports([]) });
    app.emit({ type: 'sessions', upsert: [session({ effort: null })], remove: [] });
    await waitFor(() => expect(list()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })));
  });

  it('VIEW-5.19, DIFF-3.3: a folded Changes row whose count goes while its list is open stays, the list saying "No changes", and Esc sends focus to the composer', async () => {
    const app = await show();
    const user = userEvent.setup();
    resize(500);
    await user.click(more()!);
    const changesRow = [...list()!.querySelectorAll<HTMLElement>('[data-part-row]')].find((r) => r.querySelector('[data-slot="part-name"]')?.textContent === 'Changes')!;
    await user.click(changesRow);
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toBeTruthy());
    const files: ChangesView = { sessionId: 'a', checkouts: [{ id: 'c1', root: '/r/work', repo: 'work', where: 'fx-rounding', additions: 1412, deletions: 212, files: [{ path: 'src/fx.ts', oldPath: null, kind: 'modified', additions: 18, deletions: 9, binary: false, uncommitted: false }], moreFiles: 22 }] };
    app.emit({ type: 'changes', sessionId: 'a', changes: files });
    // Every change is gone: the row's count goes, and other rows stay in "N more".
    app.emit({ type: 'sessions', upsert: [session({ changes: null })], remove: [] });
    app.emit({ type: 'changes', sessionId: 'a', changes: { sessionId: 'a', checkouts: [] } });
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toHaveTextContent('No changes'));
    expect(list()).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' })));
  });

  it('VIEW-5.19, EVID-5.4: with the Changes folded, the Evidence popover\'s Test files tile opens their list from "N more"', async () => {
    const app = await show();
    const user = userEvent.setup();
    // The Changes leave before the Evidence.
    resize(500);
    expect(onLine()).toEqual(['location', 'evidence', 'more', 'subagents', 'context']);
    await user.click(statusLine().querySelector<HTMLElement>('[data-field="evidence"]')!);
    const pop = await waitFor(() => document.querySelector<HTMLElement>('[data-slot="evidence"]')!);
    await user.click(within(pop).getByRole('button', { name: /^Test files: / }));
    await waitFor(() => expect(document.querySelector('[data-slot="evidence"]')).toBeNull());
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toBeTruthy());
    expect(list()).toBeTruthy();
    const files: ChangesView = { sessionId: 'a', checkouts: [{ id: 'c1', root: '/r/work', repo: 'work', where: 'fx-rounding', additions: 1412, deletions: 212, files: [{ path: 'src/fx.ts', oldPath: null, kind: 'modified', additions: 18, deletions: 9, binary: false, uncommitted: false }], moreFiles: 22 }] };
    app.emit({ type: 'changes', sessionId: 'a', changes: files });
    await waitFor(() => expect(document.activeElement?.closest('[data-slot="changes-list"]')).toBeTruthy());
  });

  it('VIEW-5.19: "from the next reply" goes with the Effort on the line, else the model; with both folded, on the Effort\'s row', async () => {
    const app = await show({ pendingEffort: { effort: 'xhigh', since: new Date(NOW).toISOString() } });
    const user = userEvent.setup();
    const note = (field: string) => document.querySelector(`[data-slot="${field}-note"]`);
    expect(note('effort')!.closest('[data-part]')).toHaveAttribute('data-part', 'effort');
    // The Effort leaves (with the servers): the model carries it on the line.
    resize(840);
    expect(onLine()).not.toContain('effort');
    expect(note('effort')).toBeNull();
    expect(note('model')!.closest('[data-part]')).toHaveAttribute('data-part', 'model');
    // Both leave: it's on the Effort's row, whole.
    resize(600);
    expect(onLine()).not.toContain('model');
    await user.click(more()!);
    expect(note('effort')!.closest('[data-part-row]')).toHaveAccessibleName(/^Effort: xhigh/);
    expect(note('model')).toBeNull();
    app.unmount();
  });
});
