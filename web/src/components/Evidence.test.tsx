import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { verdict, type EvidenceRound, type EvidenceRun, type EvidenceView, type VerdictKey } from '@shared/evidence.ts';
import type { ChangesView, SessionRow } from '@shared/types.ts';
import { renderApp, row } from '@/test/helpers';
import { Tile, Tiles } from '@/components/ui/details';
import { render } from '@testing-library/react';
import { doneFacts, reviewWords } from '@/lib/evidence';

// An invented Session and its Evidence (UX sketch).
const T = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00`).getTime();
const statusLine = () => screen.getByRole('group', { name: 'Status line' });
const part = () => statusLine().querySelector<HTMLButtonElement>('[data-field="evidence"]');
const popover = () => document.querySelector<HTMLElement>('[data-slot="evidence"]');
const changed = { additions: 120, deletions: 30, files: 11 };
const session = (over: Partial<SessionRow> = {}) => row({ id: 'a', title: 'Fix rounding in totals', changes: changed, evidence: verdict('changed'), ...over });

const runs: EvidenceRun[] = [
  { key: 'r1', end: T('14:26'), outcome: 'passed', passed: 2180, failed: 0, command: 'pnpm exec vitest run', subagent: false },
  { key: 'r2', end: T('14:24'), outcome: 'failed', passed: 2178, failed: 2, command: 'pnpm test 2>&1 | tail -5', subagent: false },
  { key: 'r3', end: T('14:11'), outcome: 'unread', passed: null, failed: null, command: 'pnpm test 2>&1 | grep FAIL', subagent: true },
  { key: 'r4', end: T('13:58'), outcome: 'passed', passed: 412, failed: 0, command: 'pnpm vitest run src/invoice', subagent: false },
];
const evidence = (over: Partial<EvidenceView> = {}): EvidenceView => ({
  sessionId: 'a',
  verdict: verdict('changed'),
  readAt: Date.now() - 3000,
  error: null,
  lastChange: T('14:31'),
  lastPass: { end: T('14:26'), passed: 2180 },
  runCount: runs.length,
  changedSince: 3,
  changedSinceFiles: [
    { root: '/r/shop', checkout: 'c1', path: 'src/invoice/format.ts', mtime: T('14:31'), additions: 3, deletions: 3, binary: false },
    { root: '/r/shop', checkout: 'c1', path: 'src/invoice/round.ts', mtime: T('14:30'), additions: 6, deletions: 2, binary: false },
    { root: '/r/shop', checkout: 'c1', path: 'src/invoice/totals.ts', mtime: T('14:29'), additions: 18, deletions: 9, binary: false },
  ],
  testFiles: { count: 4, added: 1, deleted: 1, additions: 64, deletions: 8 },
  changedFiles: 11,
  listedFiles: 11,
  runs,
  rounds: [],
  changedSinceReview: 0,
  ...over,
});

function show(view: EvidenceView | null = evidence(), r: SessionRow = session(), opts: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp('/s/a', opts);
  app.snapshot([r]);
  app.emit({ type: 'evidence', sessionId: 'a', evidence: view });
  return app;
}
const openPopover = async (user = userEvent.setup()) => {
  await user.click(part()!);
  await waitFor(() => expect(popover()).toBeTruthy());
  return { user, pop: popover()! };
};

describe('EVID-5: where Evidence shows', () => {
  it('EVID-5.1: the status line shows the verdict right after the Changes count, a button with the whole verdict in its tooltip', () => {
    show();
    const p = part()!;
    expect(p.tagName).toBe('BUTTON');
    expect(p).toHaveTextContent('Changed since tests');
    expect(p).toHaveAttribute('title', 'Changed after its last test run');
    expect(p).toHaveAccessibleName('Evidence: Changed after its last test run');
    // Right after the Changes count, a dot between; whole, it folds at its rank instead (VIEW-5.19).
    const changes = statusLine().querySelector('[data-field="changes"]')!;
    expect(changes.closest('[data-part]')!.nextElementSibling).toBe(p.closest('[data-part="evidence"]'));
    expect(p.previousElementSibling).toHaveAttribute('data-slot', 'status-dot');
    expect(p).toHaveClass('shrink-0');
    expect(p.querySelector('.truncate')).toBeNull();
    expect(statusLine().getAttribute('title')).toContain('Changed since tests');
  });

  it('EVID-5.1: a Session without Evidence has no part', () => {
    show(null, session({ evidence: null }));
    expect(part()).toBeNull();
  });

  it('EVID-5.2: the popover: the verdict with its warning dot and age, the tiles, then the files changed since the last pass and the runs', async () => {
    show();
    const { pop } = await openPopover();
    expect(pop).toHaveAccessibleName('Evidence: Changed after its last test run');
    const v = pop.querySelector('[data-field="verdict"]')!;
    expect(v).toHaveTextContent('Changed after its last test run');
    expect(v.querySelector('.bg-warning')).toBeTruthy();
    expect(pop.querySelector('[data-field="verdict-age"]')).toHaveTextContent(/^\ds ago$/);
    expect([...pop.querySelectorAll('[data-field^="tile-"]')].map((t) => t.getAttribute('data-field'))).toEqual(['tile-last-pass', 'tile-changed-since', 'tile-test-files', 'tile-review']);
    expect([...pop.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))).toEqual(['Changed since the last pass', 'Test runs']);
    expect(pop.querySelector('[data-field="evidence-capped"]')).toBeNull();
  });

  it('EVID-5.2: an ok or quiet verdict has the normal dot; DIFF’s cap shows a line under the verdict', async () => {
    show(evidence({ verdict: verdict('passed'), listedFiles: 500, changedFiles: 1240 }), session({ evidence: verdict('passed') }));
    const { pop } = await openPopover();
    expect(pop.querySelector('[data-field="verdict"] .bg-warning')).toBeNull();
    expect(pop.querySelector('[data-field="evidence-capped"]')).toHaveTextContent('Read from 500 of 1,240 changed files');
  });

  it('EVID-5.3: Last pass and Changed since, with and without a pass', async () => {
    const { unmount } = show();
    let { pop } = await openPopover();
    const tile = (f: string) => pop.querySelector<HTMLElement>(`[data-field="${f}"]`)!;
    expect(tile('tile-last-pass')).toHaveTextContent(/Last pass\s*\d\d:\d\d(?: [AP]M)?\s*2,180 tests passed/);
    expect(tile('tile-changed-since')).toHaveTextContent(/Changed since.*3 files.*last at \d\d:\d\d(?: [AP]M)?/);
    expect(tile('tile-changed-since').querySelector('.text-warning-text')).toBeTruthy();
    unmount();
    show(evidence({ lastPass: null, changedSince: 7, changedSinceFiles: [], runs: runs.filter((r) => r.outcome !== 'passed'), runCount: 12, verdict: verdict('failed') }));
    ({ pop } = await openPopover());
    expect(tile('tile-last-pass')).toHaveTextContent('Last pass' + 'None' + '12 test runs');
    expect(tile('tile-last-pass').querySelector('.text-warning-text')).toBeTruthy();
    expect(tile('tile-changed-since')).toHaveTextContent(/7 files/);
  });

  it('EVID-5.3: no Test run at all, and nothing changed since the pass', async () => {
    show(evidence({ lastPass: null, runs: [], runCount: 0, changedSince: 0, changedSinceFiles: [], verdict: verdict('no-run') }));
    const { pop } = await openPopover();
    expect(pop.querySelector('[data-field="tile-last-pass"]')).toHaveTextContent('Last pass' + 'None' + 'No test run');
    expect(pop.querySelector('[data-field="tile-changed-since"]')).toHaveTextContent(/Changed sinceNone/);
    expect(pop.querySelector('[data-field="tile-changed-since"] .text-warning-text')).toBeNull();
  });

  it('EVID-5.4: the Test files tile, its line leaving out parts that are 0, none, and at least', async () => {
    const tile = () => popover()!.querySelector<HTMLElement>('[data-field="tile-test-files"]')!;
    let app = show();
    await openPopover();
    expect(tile()).toHaveTextContent('Test files' + '4 of 11' + '1 added · 1 deleted · +64−8');
    expect(tile().querySelector('[data-icon="tile-chevron"]')).toBeTruthy();
    app.unmount();
    app = show(evidence({ testFiles: { count: 2, added: 0, deleted: 0, additions: 10, deletions: 0 } }));
    await openPopover();
    expect(tile()).toHaveTextContent(/^Test files2 of 11\+10$/);
    app.unmount();
    app = show(evidence({ testFiles: { count: 0, added: 0, deleted: 0, additions: 0, deletions: 0 } }));
    await openPopover();
    expect(tile()).toHaveTextContent('Test files' + 'None' + 'of 11 changed files');
    app.unmount();
    show(evidence({ listedFiles: 500, changedFiles: 1240, testFiles: { count: 4, added: 1, deleted: 0, additions: 64, deletions: 8 } }));
    await openPopover();
    expect(tile()).toHaveTextContent('at least 4' + 'of 1,240 · 1 added · +64−8');
  });

  it('EVID-5.4: a press on the Test files tile closes the popover and opens the changed-files list, which takes focus', async () => {
    const list: ChangesView = { sessionId: 'a', checkouts: [{ id: 'c1', root: '/r/shop', repo: 'shop', where: 'fix/rates', additions: 120, deletions: 30, files: [{ path: 'src/invoice/totals.ts', oldPath: null, kind: 'modified', additions: 18, deletions: 9, binary: false, uncommitted: false }], moreFiles: 10 }] };
    const app = show();
    const { user, pop } = await openPopover();
    await user.click(within(pop).getByRole('button', { name: /^Test files: 4 of 11 changed files/ }));
    await waitFor(() => expect(popover()).toBeNull());
    await waitFor(() => expect(document.querySelector('[data-slot="changes-list"]')).toBeTruthy());
    expect(app.client.watchChanges).toHaveBeenCalled();
    app.emit({ type: 'changes', sessionId: 'a', changes: list });
    await waitFor(() => expect(document.activeElement?.closest('[data-slot="changes-list"]')).toBeTruthy());
  });

  it('EVID-5.5: a Done Session’s card has one line: the verdict and two facts, cut, and an Evidence button that opens the popover', async () => {
    show(evidence(), session({ done: { at: T('14:32'), note: 'Rounding in the invoice totals is fixed.' } }));
    const card = screen.getByTestId('done-card');
    const line = card.querySelector<HTMLElement>('[data-field="done-evidence"]')!;
    expect(line).toHaveTextContent(/^Changed after its last test run · last pass \d\d:\d\d(?: [AP]M)?, 3 files changed since · no reviewEvidence$/);
    const words = line.querySelector('.truncate')!;
    expect(words).toHaveAttribute('title', expect.stringMatching(/^Changed after its last test run · last pass \d\d:\d\d(?: [AP]M)?, 3 files changed since · no review$/));
    expect(line.querySelector('[data-icon="verdict-warning"]')).toHaveClass('text-warning-text');
    // The Done chip and its tooltip don't change.
    expect(document.querySelector('[data-field="done"]')).toHaveAttribute('title', expect.stringMatching(/^Done at \d\d:\d\d(?: [AP]M)?\nRounding/));
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Evidence' }));
    await waitFor(() => expect(popover()).toBeTruthy());
    expect(popover()).toHaveAccessibleName('Evidence: Changed after its last test run');
  });

  it('EVID-5.5: the facts in words: a pass with nothing changed since, no run passed, and no run at all', () => {
    expect(doneFacts(evidence({ changedSince: 0 }))).toMatch(/^last pass \d\d:\d\d(?: [AP]M)? · no review$/);
    expect(doneFacts(evidence({ changedSince: 1 }))).toMatch(/^last pass \d\d:\d\d(?: [AP]M)?, 1 file changed since · no review$/);
    expect(doneFacts(evidence({ lastPass: null }))).toBe('no run passed · no review');
    expect(doneFacts(evidence({ lastPass: null, runCount: 0 }))).toBe('no review');
  });

  it('EVID-5.6: a warning verdict marks the row last among its marks, with its words; ok and quiet don’t', () => {
    const app = renderApp('/');
    app.snapshot([
      row({ id: 'a', title: 'Warns', changes: changed, backgroundShell: true, evidence: verdict('failed') }),
      row({ id: 'b', title: 'Backed', changes: changed, evidence: verdict('passed') }),
      row({ id: 'c', title: 'Running', changes: changed, evidence: verdict('running') }),
      row({ id: 'd', title: 'None', changes: changed }),
    ]);
    const mark = document.querySelector('[data-session-id="a"] [data-field="evidence"]')!;
    expect(mark).toHaveClass('text-warning-text');
    expect(mark).toHaveAttribute('title', 'Its last test run failed');
    expect(mark.querySelector('svg.lucide-flask-conical-off')).toBeTruthy();
    expect(mark.parentElement!.lastElementChild).toBe(mark);
    expect(mark.previousElementSibling).toHaveAttribute('data-field', 'background-shell');
    expect(screen.getByRole('option', { name: /Warns/ })).toHaveAccessibleName(expect.stringContaining('Its last test run failed'));
    for (const id of ['b', 'c', 'd']) expect(document.querySelector(`[data-session-id="${id}"] [data-field="evidence"]`)).toBeNull();
  });

  it('EVID-5.7: the icon is CircleCheck in ok, TriangleAlert in warning-text and Info in the muted colour, beside words', () => {
    const cases: [VerdictKey, string, string, string][] = [
      ['passed', 'lucide-circle-check', 'text-ok', 'text-ok-text'],
      ['failed', 'lucide-triangle-alert', 'text-warning-text', 'text-warning-text'],
      ['running', 'lucide-info', 'text-muted-foreground', 'text-muted-foreground'],
    ];
    const app = show();
    for (const [key, icon, colour, words] of cases) {
      app.emit({ type: 'evidence', sessionId: 'a', evidence: evidence({ verdict: verdict(key) }) });
      const svg = part()!.querySelector('svg')!;
      expect(svg).toHaveClass(icon, colour);
      expect(part()!.querySelector('span')).toHaveClass(words);
      expect(part()!.textContent).toBe(verdict(key).short);
    }
  });

  it('EVID-5.8: Tab reaches the part; in the popover Tab moves between the Test files tile, each changed file and each N more; Esc returns focus', async () => {
    show(evidence({ changedSince: 14, runs: Array.from({ length: 28 }, (_, n) => ({ ...runs[1]!, key: `k${n}`, end: T('14:00') - n * 60_000 })) }));
    const user = userEvent.setup();
    part()!.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(popover()).toBeTruthy());
    // Tab from the popover's start walks its buttons in order; tiles that aren't buttons and the runs take no focus.
    popover()!.querySelector<HTMLElement>('[data-field="tile-test-files"]')!.focus();
    const walked = [document.activeElement as HTMLElement];
    for (let n = 0; n < 5; n++) {
      await user.tab();
      walked.push(document.activeElement as HTMLElement);
    }
    expect(walked.map((b) => b.getAttribute('data-field') ?? b.getAttribute('data-file'))).toEqual([
      'tile-test-files',
      '/r/shop\u0000src/invoice/format.ts',
      '/r/shop\u0000src/invoice/round.ts',
      '/r/shop\u0000src/invoice/totals.ts',
      'changed-since-more',
      'runs-more',
    ]);
    expect(popover()!.querySelectorAll('button')).toHaveLength(6);
    expect(within(popover()!).getByRole('button', { name: '11 more' })).toBeTruthy();
    expect(within(popover()!).getByRole('button', { name: '8 more' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(document.activeElement).toBe(part());
  });

  it('EVID-5.8: when the Evidence goes while the popover is open, it closes and focus goes to the composer', async () => {
    const app = show();
    await openPopover();
    app.emit({ type: 'evidence', sessionId: 'a', evidence: null });
    await waitFor(() => expect(popover()).toBeNull());
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/Message/));
    expect(part()).toBeNull();
  });

  it('EVID-5.8: opening the popover from the other opener moves it there, and never closes both', async () => {
    show(evidence(), session({ done: { at: T('14:32'), note: 'Fixed' } }));
    const { user } = await openPopover();
    await user.click(within(screen.getByTestId('done-card')).getByRole('button', { name: 'Evidence' }));
    await waitFor(() => expect(document.querySelectorAll('[data-slot="evidence"]')).toHaveLength(1));
    expect(part()).toHaveAttribute('data-state', 'closed');
    await user.click(part()!);
    await waitFor(() => expect(part()).toHaveAttribute('data-state', 'open'));
    expect(document.querySelectorAll('[data-slot="evidence"]')).toHaveLength(1);
  });

  it('EVID-5.8: when the Done card goes with its popover open (the Session was prompted), focus goes to the composer, and it doesn’t reopen later', async () => {
    const done = session({ done: { at: T('14:32'), note: 'Fixed' } });
    const app = show(evidence(), done);
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('done-card')).getByRole('button', { name: 'Evidence' }));
    await waitFor(() => expect(popover()).toBeTruthy());
    app.emit({ type: 'sessions', upsert: [session({ done: null })], remove: [] });
    await waitFor(() => expect(popover()).toBeNull());
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/Message/));
    app.emit({ type: 'sessions', upsert: [done], remove: [] });
    expect(screen.getByTestId('done-card')).toBeTruthy();
    expect(popover()).toBeNull();
  });

  it('EVID-5.10: the files changed since the last pass: path cut at the folder, time and lines; a press opens it as DIFF-4 does', async () => {
    const openChange = vi.fn(async () => {});
    show(evidence(), session(), { openChange });
    const { user, pop } = await openPopover();
    const section = within(pop).getByRole('region', { name: 'Changed since the last pass' });
    const rows = within(section).getAllByRole('button');
    expect(rows[0]).toHaveTextContent(/^format\.tssrc\/invoice\/\d\d:\d\d(?: [AP]M)?\+3−3$/);
    expect(rows[0]).toHaveAttribute('title', 'src/invoice/format.ts');
    await user.click(rows[1]!);
    expect(openChange).toHaveBeenCalledWith('a', '/r/shop', 'src/invoice/round.ts');
  });

  it('EVID-5.10: a changed .plain Module opens in the Spec view, as the changed-files list opens it (PLAIN-3.1)', async () => {
    const openChange = vi.fn(async () => {});
    const files = [{ root: '/r/shop', checkout: 'c1', path: 'plain/rates.plain', mtime: T('14:31'), additions: 4, deletions: 0, binary: false }];
    show(evidence({ changedSince: 1, changedSinceFiles: files }), session(), { openChange });
    const { user, pop } = await openPopover();
    await user.click(within(within(pop).getByRole('region', { name: 'Changed since the last pass' })).getByRole('button'));
    expect(openChange).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.pathname).toBe('/plain/a/c1/plain%2Frates.plain'));
    expect(popover()).toBeNull();
  });

  it('EVID-5.10: a file that doesn’t open says why on its row; no pass or nothing changed since leaves the section out', async () => {
    const app = show(evidence(), session(), { openChange: vi.fn(async () => { throw new Error('The file is gone.'); }) });
    const { user, pop } = await openPopover();
    await user.click(within(within(pop).getByRole('region', { name: 'Changed since the last pass' })).getAllByRole('button')[0]!);
    await waitFor(() => expect(pop.querySelector('[data-slot="evidence-open-error"]')).toHaveTextContent('The file is gone.'));
    app.emit({ type: 'evidence', sessionId: 'a', evidence: evidence({ changedSince: 0, changedSinceFiles: [] }) });
    expect(within(pop).queryByRole('region', { name: 'Changed since the last pass' })).toBeNull();
  });

  it('EVID-5.11: the Test runs: the note’s counts, then newest first, one line each, and N more', async () => {
    const many = [...runs, ...Array.from({ length: 20 }, (_, n) => ({ ...runs[3]!, key: `old${n}`, end: T('12:00') - n * 60_000 }))];
    show(evidence({ runs: [...many, { ...runs[1]!, key: 'to', outcome: 'timed-out', end: T('10:00') }] }));
    const { user, pop } = await openPopover();
    const section = within(pop).getByRole('region', { name: 'Test runs' });
    expect(section.querySelector('h3')).toHaveTextContent(/TEST RUNS|Test runs/);
    expect(section.querySelector('h3 > span:last-child')).toHaveTextContent('25 · 1 failed · 1 timed out · 1 unread');
    const lines = [...section.querySelectorAll<HTMLElement>('li[data-run]')];
    expect(lines).toHaveLength(20);
    expect(lines[0]).toHaveTextContent(/^\d\d:\d\d(?: [AP]M)?passed2,180 testspnpm exec vitest run$/);
    expect(lines[1]).toHaveTextContent(/^\d\d:\d\d(?: [AP]M)?failed2 of 2,180pnpm test 2>&1 \| tail -5$/);
    expect(lines[2]).toHaveTextContent(/^\d\d:\d\d(?: [AP]M)?unreadSubagent · pnpm test 2>&1 \| grep FAIL$/);
    expect(lines[2]).toHaveAttribute('title', 'pnpm test 2>&1 | grep FAIL');
    await user.click(within(section).getByRole('button', { name: '5 more' }));
    expect(section.querySelectorAll('li[data-run]')).toHaveLength(25);
    // A summary that counted none still says so; a run without one says nothing.
    expect(section.querySelector('li[data-run="r3"] [data-field="count"]')).toBeNull();
  });

  it('EVID-5.11: a summary of no tests reads "0 tests", and a long command is whole in its tooltip', async () => {
    const long = `pnpm vitest run ${Array.from({ length: 300 }, (_, n) => `src/a${n}.test.ts`).join(' ')}`;
    show(evidence({ runs: [{ ...runs[0]!, key: 'z', outcome: 'no-tests', passed: 0, failed: 0 }, { ...runs[0]!, key: 'l', command: long }] }));
    const { pop } = await openPopover();
    expect(pop.querySelector('li[data-run="z"] [data-field="count"]')).toHaveTextContent('0 tests');
    expect(pop.querySelector('li[data-run="l"]')).toHaveAttribute('title', long);
  });

  it('EVID-1.8: a failed read shows the verdict old, in the info tone, with the reason', async () => {
    show(evidence({ error: 'tb-session took too long to answer' }));
    const { pop } = await openPopover();
    expect(pop.querySelector('[data-field="verdict-age"]')).toHaveTextContent(/^stale · \ds$/);
    expect(pop.querySelector('[data-field="verdict-age"]')).toHaveClass('text-info-text');
    expect(pop.querySelector('[data-field="evidence-error"]')).toHaveTextContent(/Couldn't read the Session's commands: tb-session took too long to answer\. Showing the read from \d\d:\d\d(?: [AP]M)?\./);
  });
});

it('DS-19.1: a Tile with an action is a button, with a chevron at its value’s end; without one it stays a plain tile', () => {
  const onClick = vi.fn();
  render(<><Tile label="Test files" value="4 of 11" onClick={onClick} field="b">1 added</Tile><Tile label="Last pass" value="14:26" field="p">2,180 tests passed</Tile></>);
  const button = screen.getByRole('button');
  expect(button).toHaveAttribute('data-field', 'b');
  expect(button.querySelector('[data-icon="tile-chevron"]')).toBeTruthy();
  expect(button).toHaveClass('rounded-md', 'bg-muted/60', 'px-2', 'py-1.5', 'hover:bg-accent');
  button.click();
  expect(onClick).toHaveBeenCalledTimes(1);
  const plain = document.querySelector('[data-field="p"]')!;
  expect(plain.tagName).toBe('DIV');
  expect(plain.querySelector('[data-icon="tile-chevron"]')).toBeNull();
});

// Invented Review rounds (EVID-6, the slice 2 sketch).
const CODEX_ID = '01a1ff23-0000-7000-8000-000000000001';
const CLAUDE_ID = '6c2d0000-0000-4000-8000-000000000002';
const dual: EvidenceRound = {
  key: 'c1', outcome: 'finished', start: T('14:14'), end: T('14:21'),
  runs: ['codex-run.sh /tmp/p-codex-dual-review-1 /shop gpt-6.1-sol xhigh', 'claude-run.sh /tmp/p-codex-dual-review-1 /shop'],
  reviewers: [
    { kind: 'headless', harness: 'codex', sessionId: CODEX_ID, transcriptMissing: false, model: 'gpt-6.1-sol', effort: 'xhigh' },
    { kind: 'headless', harness: 'claude', sessionId: CLAUDE_ID, transcriptMissing: false, model: 'claude-opus-5-5', effort: null },
  ],
};
const subagents: EvidenceRound = { key: 'a1', outcome: 'finished', start: T('13:58'), end: T('14:02'), runs: ['Code review round 1', 'Review the tests'], reviewers: [{ kind: 'subagent', model: 'claude-opus-5-5', count: 4 }] };
const round = (over: Partial<EvidenceRound>): EvidenceRound => ({ ...subagents, ...over });
const reviewTile = (pop: HTMLElement) => pop.querySelector<HTMLElement>('[data-field="tile-review"]')!;

describe('EVID-6: Review rounds', () => {
  it('EVID-6.4: four tiles in two rows of two, the Review tile last: none, finished with the files since, running, and an unfinished outcome; never a warning', async () => {
    const cases: [EvidenceRound[], number, string, string][] = [
      [[], 0, 'None', 'no review run'],
      [[dual, subagents], 4, '14:21', '2 rounds · 4 files since'],
      [[subagents], 0, '14:02', '1 round'],
      [[round({ key: 'r', outcome: 'running', start: T('14:15'), end: null }), dual], 0, 'Running', 'since 14:15 · 2 rounds'],
      [[round({ key: 'r', outcome: 'running', start: T('14:15'), end: null })], 0, 'Running', 'since 14:15'],
      [[round({ key: 'r2', outcome: 'failed' }), round({ key: 'r1', outcome: 'stopped' })], 0, 'Failed', '2 rounds'],
      [[round({ outcome: 'timed-out' })], 0, 'Timed out', '1 round'],
      [[round({ outcome: 'unread' })], 0, 'Unread', '1 round'],
    ];
    for (const [rounds, since, value, line] of cases) {
      const app = show(evidence({ rounds, changedSinceReview: since }));
      const { pop } = await openPopover();
      expect(pop.querySelector('[data-tiles="2x2"]')).toHaveClass('grid-cols-2');
      const tile = reviewTile(pop);
      expect(tile.tagName).toBe('DIV');
      const re = (text: string) => new RegExp(`^${text.replace(/\d\d:\d\d/, '\\d\\d:\\d\\d(?: [AP]M)?')}$`);
      expect(tile.children[1]!.textContent).toMatch(re(value));
      expect(tile.children[2]!.textContent).toMatch(re(line));
      expect(tile.querySelector('[data-icon]')).toBeNull();
      app.unmount();
    }
  });

  it('EVID-6.5: the Reviews section sits between the changed files and the runs; its note counts the rounds; each round its time, outcome, duration and reviewers joined by +', async () => {
    show(evidence({ rounds: [round({ key: 'r', outcome: 'running', start: Date.now() - 45_000, end: null, reviewers: [{ kind: 'subagent', model: null, count: 1 }] }), dual, subagents] }));
    const { pop } = await openPopover();
    expect([...pop.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'))).toEqual(['Changed since the last pass', 'Reviews', 'Test runs']);
    const section = pop.querySelector<HTMLElement>('[data-section="reviews"]')!;
    expect(section).toHaveTextContent(/^Reviews3 · 1 running/);
    const rows = [...section.querySelectorAll<HTMLElement>('[data-round]')];
    expect(rows.map((r) => r.getAttribute('data-outcome'))).toEqual(['running', 'finished', 'finished']);
    expect(rows[0]!.querySelector('[data-field="took"]')!.textContent).toMatch(/^4[5-9]s$/);
    expect(rows[0]!.querySelector('[data-field="reviewers"]')).toHaveTextContent('Subagent');
    expect(rows[1]!.querySelector('[data-field="round-time"]')!.textContent).toMatch(/^\d\d:\d\d(?: [AP]M)?$/);
    expect(rows[1]!.querySelector('[data-field="outcome"]')).toHaveTextContent('finished');
    expect(rows[1]!.querySelector('[data-field="took"]')).toHaveTextContent('7m');
    expect(rows[1]!.querySelector('[data-field="reviewers"]')).toHaveTextContent('Codex · gpt-6.1-sol · xhigh+Claude Code · claude-opus-5-5');
    // Reviewers that don't fit go on to more lines, under the first.
    expect(rows[1]!.querySelector('[data-field="reviewers"]')).toHaveClass('flex-wrap', 'min-w-0', 'flex-1');
    expect(rows[2]!.querySelector('[data-field="reviewers"]')).toHaveTextContent('Subagent · claude-opus-5-5 × 4');
    // The time's tooltip lists its commands and Subagent descriptions, one a line.
    expect(rows[1]!.querySelector('[data-field="round-time"]')).toHaveAttribute('title', dual.runs.join('\n'));
    expect(rows[2]!.querySelector('[data-field="round-time"]')).toHaveAttribute('title', 'Code review round 1\nReview the tests');
  });

  it('EVID-6.5: without a round the section is left out; failed, timed out, stopped and unread count in the note', async () => {
    const app = show(evidence());
    const { pop } = await openPopover();
    expect(pop.querySelector('[data-section="reviews"]')).toBeNull();
    app.unmount();
    show(evidence({ rounds: [round({ key: 'a', outcome: 'failed' }), round({ key: 'b', outcome: 'timed-out' }), round({ key: 'c', outcome: 'stopped' }), round({ key: 'd', outcome: 'unread' }), round({ key: 'e' })] }));
    const again = await openPopover();
    expect(again.pop.querySelector('[data-section="reviews"]')).toHaveTextContent(/^Reviews5 · 1 failed · 1 timed out · 1 stopped · 1 unread/);
    // EVID-6.8: a review never warns, not even one that failed.
    expect(again.pop.querySelector('[data-section="reviews"] .text-warning-text, [data-section="reviews"] [data-icon]')).toBeNull();
  });

  it('EVID-6.6: a headless reviewer is a button that closes the popover and opens it read-only; a Subagent, or one whose Transcript is gone, is text', async () => {
    const gone: EvidenceRound = { ...dual, key: 'g', reviewers: [{ ...dual.reviewers[0]!, transcriptMissing: true } as EvidenceRound['reviewers'][number]] };
    const pastSession = vi.fn(async () => { throw new Error('not here'); });
    show(evidence({ rounds: [dual, subagents, gone] }), session(), { pastSession });
    const { user, pop } = await openPopover();
    const buttons = [...pop.querySelectorAll<HTMLElement>('[data-reviewer]')];
    expect(buttons.map((b) => [b.tagName, b.getAttribute('data-reviewer')])).toEqual([['BUTTON', 'headless'], ['BUTTON', 'headless'], ['SPAN', 'subagent'], ['SPAN', 'headless']]);
    expect(buttons[0]).toHaveAccessibleName(/^Show the Codex review of \d\d:\d\d(?: [AP]M)?$/);
    expect(buttons[1]).toHaveAccessibleName(/^Show the Claude Code review of \d\d:\d\d(?: [AP]M)?$/);
    await user.click(buttons[0]!);
    await waitFor(() => expect(popover()).toBeNull());
    expect(window.location.pathname).toBe(`/h/codex/${CODEX_ID}`);
    await waitFor(() => expect(pastSession).toHaveBeenCalledWith('codex', CODEX_ID));
  });

  it('EVID-6.6: Tab reaches each reviewer button after the changed files; Esc returns focus to the opener', async () => {
    show(evidence({ changedSince: 1, changedSinceFiles: evidence().changedSinceFiles.slice(0, 1), rounds: [dual] }));
    const { user, pop } = await openPopover();
    const name = () => {
      const el = document.activeElement as HTMLElement;
      return el.getAttribute('data-field') ?? el.getAttribute('data-file') ?? el.getAttribute('data-reviewer') ?? el.tagName;
    };
    // The popover opens on its first button, the Test files tile.
    const order = [name()];
    for (let i = 0; i < 3; i++) {
      await user.tab();
      order.push(name());
    }
    expect(order).toEqual(['tile-test-files', '/r/shop\u0000src/invoice/format.ts', 'headless', 'headless']);
    expect(pop.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(document.activeElement).toBe(part());
  });

  it('EVID-6.7: the Done card’s line adds the rounds in words, muted, one line with the whole in its tooltip', () => {
    show(evidence({ rounds: [dual, subagents] }), session({ done: { at: T('14:32'), note: 'Fixed.' } }));
    const line = screen.getByTestId('done-card').querySelector<HTMLElement>('[data-field="done-evidence"]')!;
    const words = line.querySelector('.truncate')!;
    expect(words).toHaveAttribute('title', expect.stringMatching(/ · reviewed twice$/));
    expect(words.querySelector('.text-muted-foreground')).toHaveTextContent(/· reviewed twice$/);
    expect(reviewWords([])).toBe('no review');
    expect(reviewWords([subagents])).toBe('reviewed once');
    expect(reviewWords([dual, subagents, round({ key: 'x' })])).toBe('reviewed 3 times');
    expect(reviewWords([round({ key: 'r', outcome: 'running', end: null }), dual])).toBe('a review is running');
    expect(reviewWords([round({ outcome: 'failed' }), round({ key: 'b', outcome: 'stopped' })])).toBe('the review failed');
    expect(reviewWords([round({ outcome: 'timed-out' })])).toBe('the review timed out');
    expect(reviewWords([round({ outcome: 'stopped' })])).toBe('the review was stopped');
    expect(reviewWords([round({ outcome: 'unread' })])).toBe('the review is unread');
  });

  it('EVID-6.8: rounds never change the status line’s part or the row’s mark', async () => {
    // No review, the verdict ok: no warning, no mark.
    const before = show(evidence({ verdict: verdict('passed'), rounds: [] }), session({ evidence: verdict('passed') }));
    expect(part()).toHaveTextContent('Tests passed');
    expect(document.querySelector('[data-session-id="a"] [data-field="evidence"]')).toBeNull();
    before.unmount();
    // A review that failed, the verdict ok: the part and the row are the same.
    show(evidence({ verdict: verdict('passed'), rounds: [round({ outcome: 'failed' })] }), session({ evidence: verdict('passed') }));
    expect(part()).toHaveTextContent('Tests passed');
    expect(part()).toHaveAttribute('title', 'Tests passed after its last change');
    expect(document.querySelector('[data-session-id="a"] [data-field="evidence"]')).toBeNull();
  });

  it('EVID-6.9: a reviewer without a model shows as its Harness alone', async () => {
    show(evidence({ rounds: [{ ...dual, reviewers: [{ kind: 'headless', harness: 'codex', sessionId: CODEX_ID, transcriptMissing: false, model: null, effort: null }] }] }));
    const { pop } = await openPopover();
    expect(pop.querySelector('[data-field="reviewers"]')!.textContent).toBe('Codex');
  });
});

it('DS-19.1: four tiles take two rows of two; three stay side by side', () => {
  const { container, rerender } = render(<Tiles><Tile label="a" value="1" /><Tile label="b" value="2" /><Tile label="c" value="3" /></Tiles>);
  expect(container.firstElementChild).toHaveClass('grid-cols-3');
  rerender(<Tiles><Tile label="a" value="1" /><Tile label="b" value="2" /><Tile label="c" value="3" /><Tile label="d" value="4" /></Tiles>);
  expect(container.firstElementChild).toHaveClass('grid-cols-2');
});
