import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESC_POINTER } from '@/lib/answers';
import { SaveError } from '@/lib/client';
import { COPY_FEEDBACK_MS } from '@/lib/copy';
import { contextLevel } from '@/lib/sessions';
import css from '@/index.css?raw';
import { colourOf, contrast, paint, solid, themeTokens } from '@/test/contrast';
import { renderApp, row, rowEl, settings } from '@/test/helpers';

const header = () => screen.getByRole('banner', { name: 'Session' });
const drawerToggle = () => screen.getByRole('button', { name: /Terminal/ });
const statusLine = () => screen.getByRole('group', { name: 'Status line' });

describe('Session view header', () => {
  it('VIEW-8.3: the running and done text keep 4.5:1 on the status line in light and dark mode', () => {
    const themes = themeTokens(css);
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    for (const subagents of [{ running: 2, finished: 1 }, { running: 0, finished: 3 }]) {
      app.emit({ type: 'sessions', upsert: [row({ id: 'a', subagents })], remove: [] });
      const line = statusLine();
      const bg = colourOf(line.className, 'bg')!;
      const text = colourOf(line.querySelector('[data-field="subagents"]')!.className, 'text')!;
      expect(bg).toEqual({ token: 'muted', alpha: 0.3 });
      for (const mode of ['light', 'dark'] as const) {
        const t = themes[mode];
        const under = paint(t, bg.token, solid(t, 'background'), bg.alpha);
        const ratio = contrast(paint(t, text.token, under, text.alpha), under);
        expect(Number.isFinite(ratio)).toBe(true);
        expect(ratio, `${mode} ${text.token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('VIEW-8.1: running Subagents are the last status-line part in Busy blue, whatever the main thread Status', () => {
    const app = renderApp('/s/a');
    const base = row({ id: 'a', contextPct: 23, model: 'claude-opus-5-5' });
    app.snapshot([base]);
    for (const status of ['busy', 'idle', 'needs-you', 'unknown'] as const) {
      for (const running of [1, 2]) {
        app.emit({ type: 'sessions', upsert: [{ ...base, status, subagents: { running, finished: 3 } }], remove: [] });
        const part = statusLine().querySelector('[data-field="subagents"]')!;
        expect(part).toHaveTextContent(running === 1 ? /^1 subagent$/ : /^2 subagents$/);
        expect(part).toHaveClass('text-busy-text');
        expect(part).toHaveAttribute('data-state', 'running');
        expect(statusLine().lastElementChild).toBe(part);
        expect(part.previousElementSibling!.previousElementSibling).toHaveAttribute('data-field', 'context');
      }
    }
  });

  it('VIEW-8.2: none running gives the Turn\'s finished count in Idle grey, and no part for none or unknown', () => {
    const app = renderApp('/s/a');
    const base = row({ id: 'a' });
    app.snapshot([base]);
    for (const finished of [1, 3]) {
      app.emit({ type: 'sessions', upsert: [{ ...base, subagents: { running: 0, finished } }], remove: [] });
      const part = statusLine().querySelector('[data-field="subagents"]')!;
      expect(part).toHaveTextContent(finished === 1 ? /^1 subagent done$/ : /^3 subagents done$/);
      expect(part).toHaveClass('text-idle-text');
      expect(part).toHaveAttribute('data-state', 'done');
    }
    for (const subagents of [{ running: 0, finished: 0 }, null, undefined]) {
      app.emit({ type: 'sessions', upsert: [{ ...base, subagents } as never], remove: [] });
      expect(statusLine().querySelector('[data-field="subagents"]')).toBeNull();
      expect(statusLine()).toHaveAttribute('title', 'work · main');
    }
  });

  it('VIEW-8.3: list updates move running to done to cleared, keeping a truncated part and the whole line in its tooltip', () => {
    const app = renderApp('/s/a');
    const base = row({ id: 'a', contextPct: 23, effort: 'high', model: 'claude-opus-5-5' });
    app.snapshot([{ ...base, subagents: { running: 2, finished: 0 } }]);
    const line = statusLine();
    expect(line).toHaveClass('whitespace-nowrap', 'overflow-hidden', 'h-7');
    for (const subagents of [{ running: 1, finished: 2 }, { running: 0, finished: 3 }, { running: 0, finished: 0 }]) {
      app.emit({ type: 'sessions', upsert: [{ ...base, subagents }], remove: [] });
      const text = subagents.running ? '1 subagent' : subagents.finished ? '3 subagents done' : null;
      expect(line).toHaveAttribute('title', `work · main · claude-opus-5-5 · high · 23% context${text ? ` · ${text}` : ''}`);
      const part = line.querySelector('[data-field="subagents"]');
      if (text) expect(part).toHaveClass('min-w-0', 'truncate');
      else expect(part).toBeNull();
    }
  });

  it('VIEW-8.4: View only Sessions show the part, ended Sessions drop it and the header never has it', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', controllable: false, backend: 'unknown', subagents: { running: 2, finished: 1 } })]);
    expect(statusLine().querySelector('[data-field="subagents"]')).toHaveTextContent('2 subagents');
    expect(header().querySelector('[data-field="subagents"]')).toBeNull();
    expect(header()).not.toHaveTextContent(/subagent/i);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(statusLine().querySelector('[data-field="subagents"]')).toBeNull();
    expect(statusLine()).toHaveAttribute('title', 'work · main');
    expect(header()).toHaveTextContent('Ended');
  });

  it('VIEW-5.1: the header shows the title, Harness and Status, updating live; where it works and its model are not in it', () => {
    const app = renderApp('/s/a');
    app.snapshot([
      row({ id: 'a', title: 'fix-deal-rates', model: 'claude-opus-5-5', status: 'busy', contextPct: 41, git: { repo: 'work', worktree: 'crm-rates', branch: 'x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
    ]);
    const h = header();
    expect(within(h).getByRole('heading', { level: 1 })).toHaveTextContent('fix-deal-rates');
    expect(h.querySelector('[data-field="harness"]')).toHaveTextContent(/Claude Code$/);
    expect(h.querySelector('[data-field="harness"]')).not.toHaveTextContent('·');
    expect(within(h).getByRole('img', { name: 'Claude Code' })).toHaveAttribute('data-harness', 'claude');
    expect(h.querySelector('[data-field="status"]')).toHaveTextContent('Busy');
    expect(h).not.toHaveTextContent('claude-opus-5-5');
    expect(h).not.toHaveTextContent('crm-rates');
    expect(h).not.toHaveTextContent('41% context');

    app.emit({
      type: 'sessions',
      upsert: [row({ id: 'a', title: 'renamed', model: 'claude-opus-5-5', status: 'needs-you', waitingFor: 'input needed', contextPct: 55 })],
      remove: [],
    });
    expect(within(h).getByRole('heading', { level: 1 })).toHaveTextContent('renamed');
    expect(h.querySelector('[data-field="status"]')).toHaveTextContent('Needs you');
    // What it waits for isn't repeated in the header: the chat's Needs you row says it (VIEW-1.10).
    expect(h).not.toHaveTextContent('input needed');
    expect(screen.getByTestId('chat-activity')).toHaveTextContent('Needs you · input needed');
  });

  it('VIEW-5.5: one status line directly below the composer shows repo, Worktree or branch, model and context use, updating live', () => {
    const app = renderApp('/s/a');
    app.snapshot([
      row({ id: 'a', model: 'claude-opus-5-5', contextPct: 41, git: { repo: 'work', worktree: 'crm-rates', branch: 'x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } }),
    ]);
    const line = statusLine();
    // Directly below the composer.
    const composer = screen.getByRole('textbox', { name: 'Message' }).closest('form')!;
    expect(composer.nextElementSibling).toBe(line);
    expect(line.querySelector('[data-field="repo"]')).toHaveTextContent('work');
    expect(line.querySelector('[data-field="location"]')).toHaveTextContent('crm-rates');
    expect(within(line).getByLabelText('Worktree')).toBeInTheDocument();
    expect(line.querySelector('[data-field="model"]')).toHaveTextContent('claude-opus-5-5');
    expect(line.querySelector('[data-field="context"]')).toHaveTextContent('41% context');
    expect(line).toHaveAttribute('title', 'work · crm-rates · claude-opus-5-5 · 41% context');

    app.emit({
      type: 'sessions',
      upsert: [row({ id: 'a', model: 'claude-sonnet-5-5', contextPct: 55, git: { repo: 'work', worktree: null, branch: 'main', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } })],
      remove: [],
    });
    expect(line.querySelector('[data-field="location"]')).toHaveTextContent('main');
    expect(within(line).getByLabelText('Branch')).toBeInTheDocument();
    expect(line.querySelector('[data-field="model"]')).toHaveTextContent('claude-sonnet-5-5');
    expect(line.querySelector('[data-field="context"]')).toHaveTextContent('55% context');
  });

  it('VIEW-5.5: at narrow widths it stays one line: nothing wraps, long parts truncate, and the tooltip has it all', () => {
    const long = 'a-very-long-worktree-name-that-would-never-fit-at-a-narrow-width-'.repeat(3);
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', contextPct: 9, git: { repo: 'work', worktree: long, branch: 'x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' } })]);
    const line = statusLine();
    expect(line).toHaveClass('whitespace-nowrap', 'overflow-hidden', 'h-7');
    for (const f of ['repo', 'model']) expect(line.querySelector(`[data-field="${f}"]`)).toHaveClass('truncate', 'min-w-0');
    expect(line.querySelector('[data-field="location"] .truncate')).toHaveTextContent(long);
    expect(line.querySelector('[data-field="location"]')).toHaveAttribute('title', long);
    expect(line.getAttribute('title')).toContain(long);
  });

  it('VIEW-5.11: the Effort follows the model as its own part, updating live, and nothing takes its place without one', () => {
    const app = renderApp('/s/a');
    const git = { repo: 'work', worktree: 'crm-rates', branch: 'x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' };
    app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', effort: 'medium', contextPct: 41, git })]);
    const line = statusLine();
    const effort = () => line.querySelector('[data-field="effort"]');
    expect(effort()).toHaveTextContent(/^medium$/);
    // Right after the model, before the context usage.
    // (Both are menus here, VIEW-6 and VIEW-7: the parts are in order, whatever wraps them.)
    const parts = [...line.querySelectorAll('[data-field]')].map((e) => e.getAttribute('data-field'));
    expect(parts.slice(parts.indexOf('model'), parts.indexOf('model') + 3)).toEqual(['model', 'effort', 'context']);
    expect(line).toHaveAttribute('title', 'work · crm-rates · claude-opus-5-5 · medium · 41% context');

    // `/effort high`: Fleet reports it once the next reply reaches the Transcript.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', model: 'claude-opus-5-5', effort: 'high', contextPct: 42, git })], remove: [] });
    expect(effort()).toHaveTextContent(/^high$/);

    // No Effort (null, or an older Fleet without the field): no part, no extra separator.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', model: 'claude-opus-5-5', effort: null, contextPct: 42, git })], remove: [] });
    expect(effort()).toBeNull();
    expect(line).toHaveAttribute('title', 'work · crm-rates · claude-opus-5-5 · 42% context');
    expect(line.textContent).toBe('work·crm-rates·claude-opus-5-5·42% context');
  });

  it('VIEW-5.11: it keeps the line one line: the Effort truncates like the other parts', () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', model: 'gpt-6-luna', harness: 'codex', effort: 'xhigh', contextPct: 9 })]);
    const line = statusLine();
    expect(line).toHaveClass('whitespace-nowrap', 'overflow-hidden', 'h-7');
    expect(line.querySelector('[data-field="effort"]')).toHaveClass('truncate', 'min-w-0');
    expect(line.querySelector('[data-field="effort"]')).toHaveAttribute('title', 'xhigh');
    expect(line.getAttribute('title')).toContain('gpt-6-luna · xhigh');
  });

  it('VIEW-5.16: an Idle Session with a background shell running is Idle in the pane, and the status line ends with `shell running` in Idle\'s grey', () => {
    const app = renderApp('/s/a');
    const git = { repo: 'work', worktree: 'crm-rates', branch: 'x', commonDir: '/Users/me/Projects/work/.git', defaultBranch: 'main' };
    app.snapshot([row({ id: 'a', title: 'fix-rates', model: 'claude-opus-5-5', effort: 'high', contextPct: 41, git, backgroundShell: true })]);
    const line = statusLine();
    const shell = () => line.querySelector('[data-field="background-shell"]');
    expect(shell()).toHaveTextContent(/^shell running$/);
    expect(shell()).toHaveClass('text-idle-text', 'truncate', 'min-w-0');
    expect(shell()).toHaveAttribute('title', 'A background shell command is still running');
    expect(line.lastElementChild).toBe(shell());
    expect(line).toHaveAttribute('title', 'work · crm-rates · claude-opus-5-5 · high · 41% context · shell running');
    // Idle in every way: the header's tag, the composer, renaming and the model menu.
    expect(header().querySelector('[data-field="status"]')).toHaveTextContent('Idle');
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    expect(within(header()).getByRole('button', { name: /^fix-rates/ })).toBeEnabled();
    expect(within(line).getByRole('button', { name: /^Model: / })).toBeEnabled();

    // The shell ends: the part goes, with its separator.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates', model: 'claude-opus-5-5', effort: 'high', contextPct: 41, git })], remove: [] });
    expect(shell()).toBeNull();
    expect(line).toHaveAttribute('title', 'work · crm-rates · claude-opus-5-5 · high · 41% context');

    // An ended Session shows none, whatever it showed last.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', title: 'fix-rates', model: 'claude-opus-5-5', contextPct: 41, git, backgroundShell: true })], remove: [] });
    expect(shell()).not.toBeNull();
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(statusLine().querySelector('[data-field="background-shell"]')).toBeNull();
  });

  it('VIEW-5.5: without a composer (a view-only or ended Session) the status line sits at the bottom of the pane', () => {
    const app = renderApp('/s/orca');
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false, contextPct: 12 })]);
    const line = statusLine();
    expect(line.parentElement!.lastElementChild).toBe(line);
    expect(line.querySelector('[data-field="context"]')).toHaveTextContent('12% context');
  });

  it('VIEW-5.5: context usage reads normal up to 40%, warning above 40%, danger above 60%', () => {
    expect([0, 40, 41, 60, 61, 100].map(contextLevel)).toEqual(['normal', 'normal', 'warning', 'warning', 'danger', 'danger']);
    const cases = [
      [40, 'normal', null],
      [41, 'warning', 'text-warning-text'],
      [60, 'warning', 'text-warning-text'],
      [61, 'danger', 'text-destructive-text'],
    ] as const;
    for (const [pct, level, cls] of cases) {
      const app = renderApp('/s/a');
      app.snapshot([row({ id: 'a', model: 'claude-opus-5-5', contextPct: pct })]);
      const ctx = statusLine().querySelector('[data-field="context"]')!;
      expect(ctx).toHaveTextContent(`${pct}% context`);
      expect(ctx).toHaveAttribute('data-level', level);
      for (const c of ['text-warning-text', 'text-destructive-text']) expect(ctx.classList.contains(c)).toBe(c === cls);
      app.unmount();
    }
  });

  it("VIEW-5.9: the Status tag is in its Status's colour, updating live; an ended Session's stays muted", () => {
    const app = renderApp('/s/a');
    const tag = () => header().querySelector<HTMLElement>('[data-field="status"]')!;
    const colours = {
      'needs-you': ['bg-needs-you', 'text-needs-you-foreground'],
      busy: ['bg-busy-soft', 'text-busy-text'],
      idle: ['bg-idle-soft', 'text-idle-text'],
      unknown: ['bg-idle-soft', 'text-idle-text'],
    } as const;
    // Every colour a tag could take, so a stray one (the neutral grey Busy and Idle had) fails too.
    const any = ['bg-muted', 'text-muted-foreground', 'text-foreground/80', ...new Set(Object.values(colours).flat())];
    const labels = { 'needs-you': 'Needs you', busy: 'Busy', idle: 'Idle', unknown: 'Unknown' } as const;
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    for (const status of ['busy', 'needs-you', 'idle', 'unknown'] as const) {
      app.emit({ type: 'sessions', upsert: [row({ id: 'a', status })], remove: [] });
      expect(tag()).toHaveTextContent(labels[status]);
      for (const c of any) expect(tag().classList.contains(c), `${status}: ${c}`).toBe((colours[status] as readonly string[]).includes(c));
      // The age reads in the tag's own colour: dimmed, it fell below 4.5:1 (sessions.test.ts measures them).
      const age = tag().querySelector('span')!;
      expect(age).toHaveTextContent(/^· \d+[smhd]$/);
      expect([...age.classList].filter((c) => c.startsWith('opacity-') || c.startsWith('text-'))).toEqual([]);
    }

    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(tag()).toHaveTextContent('Ended');
    for (const c of any) expect(tag().classList.contains(c), `ended: ${c}`).toBe(c === 'bg-muted' || c === 'text-muted-foreground');
  });

  describe('Copy session ID (VIEW-5.10)', () => {
    const copyButton = () => within(header()).queryByRole('button', { name: 'Copy session ID' });
    let restore: (() => void) | null = null;
    const clipboard = (writeText: (text: string) => Promise<void>) => {
      const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      restore = () => (had ? Object.defineProperty(navigator, 'clipboard', had) : delete (navigator as { clipboard?: unknown }).clipboard);
    };
    afterEach(() => {
      restore?.();
      restore = null;
      vi.useRealTimers();
    });

    it('VIEW-5.10: a Session with a session_id has a "Copy session ID" button in the header whose tooltip shows the whole ID; a click copies it and reads "Copied" for 2 s', async () => {
      const id = '3f2b8c1e-9a47-4d6e-b0c5-7e1d2a9f4b68';
      const writeText = vi.fn(async () => {});
      clipboard(writeText);
      const app = renderApp(`/s/${id}`);
      app.snapshot([row({ id, ownHost: true })]);
      const button = copyButton()!;
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('title', expect.stringContaining(id));
      expect(button.querySelector('svg.lucide-copy')).not.toBeNull(); // lucide's icon, never emoji
      expect(within(header().querySelector('[data-slot="header-actions"]')!).getAllByRole('button').at(-1)).toBe(button); // last: keeps its place
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.click(button);
      await act(async () => {});
      expect(writeText).toHaveBeenCalledWith(id);
      expect(button).toHaveTextContent('Copied');
      expect(button).toHaveAccessibleName('Copy session ID'); // it keeps its name…
      expect(within(header()).getByRole('status')).toHaveTextContent('Copied'); // …and says the outcome
      act(() => vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1));
      expect(button).toHaveTextContent('Copied');
      act(() => vi.advanceTimersByTime(1));
      expect(button).not.toHaveTextContent('Copied');
      expect(within(header()).getByRole('status')).toHaveTextContent('');
    });

    it('VIEW-5.10: "Couldn’t copy" when the browser refuses', async () => {
      clipboard(async () => {
        throw new DOMException('Document is not focused.', 'NotAllowedError');
      });
      const app = renderApp('/s/a');
      app.snapshot([row({ id: 'a' })]);
      fireEvent.click(copyButton()!);
      expect(await within(copyButton()!).findByText("Couldn't copy")).toBeInTheDocument();
      expect(copyButton()).toHaveClass('text-destructive');
    });

    it('VIEW-5.10: it is reachable with Tab, and Enter copies', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn(async () => {});
      clipboard(writeText);
      const app = renderApp('/s/a');
      app.snapshot([row({ id: 'a' })]);
      copyButton()!.focus();
      expect(copyButton()).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(writeText).toHaveBeenCalledWith('a');
    });

    it('VIEW-5.10: a Session without a session_id (a Codex Session before its first prompt) has no button, and gets one with its ID', () => {
      const app = renderApp('/s/codex%3A42');
      app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex', title: 'codex-run' })]);
      expect(copyButton()).toBeNull();
      expect(header()).not.toHaveTextContent('codex:42');
      app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex', title: 'codex-run' })], remove: ['codex:42'] });
      expect(copyButton()).toHaveAttribute('title', expect.stringContaining('uuid-1'));
    });

    it('VIEW-5.10: it shows for a Session that is not Controllable, and for one that has ended', () => {
      const app = renderApp('/s/orca');
      app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false })]);
      expect(copyButton()).toHaveAttribute('title', expect.stringContaining('orca'));
      app.emit({ type: 'sessions', upsert: [], remove: ['orca'] });
      expect(screen.getByText('This Session ended')).toBeInTheDocument();
      expect(copyButton()).toHaveAttribute('title', expect.stringContaining('orca'));
    });

    it('VIEW-5.10: it never shrinks, and its word goes below 26rem like the other buttons’', async () => {
      clipboard(async () => {});
      const app = renderApp('/s/a');
      app.snapshot([row({ id: 'a' })]);
      expect(copyButton()).toHaveClass('shrink-0');
      fireEvent.click(copyButton()!);
      await act(async () => {});
      expect(within(copyButton()!).getByText('Copied')).toHaveClass('@max-[26rem]:sr-only');
    });
  });

  it('VIEW-5.4: with nothing selected, the "Select a Session" hint stays', () => {
    const app = renderApp('/');
    app.snapshot([row({ id: 'a' })]);
    expect(screen.getByText('Select a Session')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });
});

describe('ending a Session', () => {
  const endButton = () => within(header()).queryByRole('button', { name: 'End Session' });

  it('VIEW-5.6: "End Session" is in the header only for a Controllable Session in a Session host of its own', () => {
    const app = renderApp('/s/own');
    app.snapshot([
      row({ id: 'own', ownHost: true }),
      row({ id: 'shared', ownHost: false }),
      row({ id: 'iterm', backend: 'iterm', ownHost: false }),
      row({ id: 'orca', backend: 'unknown', controllable: false, ownHost: false }),
    ]);
    expect(endButton()).toBeInTheDocument();
    for (const id of ['shared', 'iterm', 'orca']) {
      act(() => window.history.pushState(null, '', `/s/${id}`));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      expect(endButton()).toBeNull();
    }
  });

  it('VIEW-5.6: it asks in an in-app dialog first (never window.confirm); Cancel ends nothing, End Session ends it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', ownHost: true })]);
    await user.click(endButton()!);
    const dialog = screen.getByRole('dialog', { name: 'End “fix-rates”?' });
    expect(dialog).toHaveTextContent('you can resume it from History');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(app.client.endSession).not.toHaveBeenCalled();

    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    expect(app.client.endSession).toHaveBeenCalledWith('a', { pid: 100, procStart: '2026-10-14T08:12:03Z' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('VIEW-5.7: afterwards the Session shows as ended, its chat stays readable, and the button is gone', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', ownHost: true })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [{ kind: 'user', cursor: 'c1', ts: null, text: 'Fix the rounding', queued: false }], before: null, queue: [] });
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    // Fleet closed it: the next list no longer has it.
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(header().querySelector('[data-field="status"]')).toHaveTextContent('Ended');
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(screen.getByText('Fix the rounding')).toBeInTheDocument();
    expect(endButton()).toBeNull();
  });

  it('VIEW-5.8: a refusal is shown in the dialog, which stays open to try again', async () => {
    const user = userEvent.setup();
    const endSession = vi.fn(async () => {
      throw new SaveError('Fleet is typing into it; try again.', null, 409);
    });
    const app = renderApp('/s/a', { endSession });
    app.snapshot([row({ id: 'a', ownHost: true })]);
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Fleet is typing into it; try again.');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' })).toBeEnabled();
    // The rest of the page is hidden from assistive tech while the dialog is open.
    expect(document.querySelector('header [data-field="status"]')).not.toHaveTextContent('Ended');
  });
});

describe('ending the confirmed Session only', () => {
  const endButton = () => within(header()).queryByRole('button', { name: 'End Session' });
  const confirmIn = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' });

  it('VIEW-5.6: the dialog binds to the process it opened on: a restart meanwhile sends the confirmed pid and start time, not the new ones', async () => {
    const user = userEvent.setup();
    const endSession = vi.fn(async () => {
      throw new SaveError('This Session was restarted since you asked; nothing was closed.', null, 409);
    });
    const app = renderApp('/s/a', { endSession });
    app.snapshot([row({ id: 'a', ownHost: true, pid: 111, procStart: '2026-10-14T08:00:00Z' })]);
    await user.click(endButton()!);
    // Resumed from another tab under a new process while this dialog was open.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: true, pid: 222, procStart: '2026-10-17T10:00:00Z' })], remove: [] });
    await user.click(confirmIn());
    expect(endSession).toHaveBeenCalledWith('a', { pid: 111, procStart: '2026-10-14T08:00:00Z' });
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('This Session was restarted since you asked; nothing was closed.');
  });

  it('VIEW-5.6: without a process start time the dialog refuses and says to close it in the terminal; nothing is sent', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true, procStart: null })]);
    await user.click(endButton()!);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(/can’t confirm it’s the same Session.*Close it in the terminal/);
    expect(confirmIn()).toBeDisabled();
    expect(app.client.endSession).not.toHaveBeenCalled();
  });

  it('VIEW-5.6: background shortcuts stand down while the dialog is open: arrows, H and N change nothing behind it', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true }), row({ id: 'b', ownHost: true })]);
    await user.click(endButton()!);
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }).focus();
    for (const key of ['{ArrowDown}', '{ArrowUp}', 'j', 'k', 'h', 'n']) {
      await user.keyboard(key);
      expect(window.location.pathname).toBe('/s/a');
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1); // no launcher on top
    expect(screen.getByRole('dialog', { name: 'End “a”?' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /History/ })).toBeNull();
    // Once it's closed they work again.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    const seen = new Set<string>();
    for (const key of ['{ArrowDown}', '{ArrowUp}']) {
      await user.keyboard(key);
      seen.add(window.location.pathname);
    }
    expect(seen).toContain('/s/b');
  });

  it('VIEW-5.6: ⌘N, ⌘1–9 and ⌘J stand down while the dialog is open too', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true }), row({ id: 'b', ownHost: true, status: 'needs-you' })]);
    await user.click(endButton()!);
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }).focus();
    for (const key of ['{Meta>}n{/Meta}', '{Meta>}1{/Meta}', '{Meta>}2{/Meta}', '{Meta>}j{/Meta}']) {
      await user.keyboard(key);
      expect(window.location.pathname).toBe('/s/a');
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1); // no launcher on top
    expect(screen.getByRole('dialog', { name: 'End “a”?' })).toBeInTheDocument();
    // Once it's closed they work again.
    await user.keyboard('{Escape}');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(window.location.pathname).toBe('/s/b');
  });

  it('VIEW-5.6: focus goes to the header’s title when the button is gone: after a successful end, or Cancel once it no longer applies', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true }), row({ id: 'b', ownHost: true })]);
    const title = () => within(header()).getByRole('heading', { level: 1 });
    // Cancel after another Session joined its host: the button went while the dialog was open.
    await user.click(endButton()!);
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: false })], remove: [] });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(title()).toHaveFocus());
    // A successful end: focus doesn't go to the button that's about to go.
    await user.click(rowEl('b'));
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End Session' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(title()).toHaveFocus());
    app.emit({ type: 'sessions', upsert: [], remove: ['b'] });
    expect(title()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('VIEW-5.6: a Codex Session getting its session id keeps an open or pending dialog, and the request’s result is shown', async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const endSession = vi.fn(() => new Promise<never>((_, r) => (reject = r)));
    const app = renderApp('/s/codex%3A42', { endSession });
    const codex = (id: string) => row({ id, pid: 42, harness: 'codex', title: 'codex-run', ownHost: true, procStart: '2026-10-17T09:00:00Z' });
    app.snapshot([codex('codex:42')]);
    await user.click(endButton()!);
    // Open: it gets its session id, the selection follows, the dialog stays.
    app.emit({ type: 'sessions', upsert: [codex('uuid-1')], remove: ['codex:42'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-1'));
    expect(screen.getByRole('dialog', { name: 'End “codex-run”?' })).toBeInTheDocument();
    await user.click(confirmIn());
    expect(endSession).toHaveBeenCalledWith('uuid-1', { pid: 42, procStart: '2026-10-17T09:00:00Z' });
    await act(async () => reject(new SaveError('Fleet is typing into it; try again.', null, 409)));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Fleet is typing into it; try again.');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    // Pending: the request went out under the pid id; its result still reaches the dialog.
    app.emit({ type: 'snapshot', sessions: [codex('codex:43')].map((r) => ({ ...r, pid: 43 })), fleet: { state: 'ok' }, settings: settings(), launches: [], started: [], clientId: 'tab-1', usage: null, memory: null });
    await act(async () => window.history.pushState({}, '', '/s/codex%3A43'));
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    await user.click(endButton()!);
    await user.click(confirmIn());
    expect(endSession).toHaveBeenLastCalledWith('codex:43', { pid: 43, procStart: '2026-10-17T09:00:00Z' });
    app.emit({ type: 'sessions', upsert: [{ ...codex('uuid-2'), pid: 43 }], remove: ['codex:43'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-2'));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ending…' })).toBeDisabled();
    await act(async () => reject(new SaveError('This Session was restarted since you asked; nothing was closed.', null, 409)));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('restarted since you asked');
  });

  it('VIEW-5.6: closing the dialog, by Cancel or Escape, puts focus back on the End Session button', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', ownHost: true })]);
    await user.click(endButton()!);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(endButton()).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(endButton()).toHaveFocus());
  });

  it('VIEW-5.8: an open or pending dialog stays when the button stops applying, so the shared-host refusal is still shown', async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    const endSession = vi.fn(() => new Promise<never>((_, r) => (reject = r)));
    const app = renderApp('/s/a', { endSession });
    app.snapshot([row({ id: 'a', ownHost: true })]);
    await user.click(endButton()!);
    // Another Session joined its host while the dialog was open: the button goes, the dialog stays.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: false })], remove: [] });
    // (The page behind the dialog is hidden from assistive tech, so look it up in the DOM.)
    expect(document.querySelector('[data-slot="header-actions"] [title="End Session"]')).toBeNull();
    await user.click(confirmIn());
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ending…' })).toBeDisabled();
    // And while it's pending.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', ownHost: false, backend: 'iterm' })], remove: [] });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => reject(new SaveError('This Session shares its Session host with other windows, so Lookout won’t end it. Close it in the terminal.', null, 409)));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(/shares its Session host.*Close it in the terminal/);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('terminal preview', () => {
  it('VIEW-2.1: an open drawer shows the terminal text as is, and the tab asks the server to peek only then', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false'); // collapsed by default
    expect(screen.queryByTestId('terminal-preview')).toBeNull();

    await user.click(drawerToggle());
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    app.emit({ type: 'preview', sessionId: 'a', text: '❯ Reply with OK\n⏺ OK  <b>not html</b>', error: null });
    expect(screen.getByTestId('terminal-preview').textContent).toBe('❯ Reply with OK\n⏺ OK  <b>not html</b>');

    app.emit({ type: 'preview', sessionId: 'a', text: '❯ Reply with OK\n⏺ OK', error: 'Preview failed: no such pane' });
    expect(drawerToggle()).toHaveTextContent('Preview failed: no such pane · retrying');

    await user.click(drawerToggle());
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
  });

  it('VIEW-2.2 (support): opens on its own when the Session starts to Need you; a manual toggle wins until the Status changes', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    // As the server does, every Status change comes with a new status-change time.
    app.snapshot([row({ id: 'a', status: 'busy', statusSince: 1 })]);
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: 2 })], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(drawerToggle()); // you close it while it Needs you
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false');
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: 2, waitingFor: 'other' })], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'false'); // same Status: yours wins

    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'busy', statusSince: 3 })], remove: [] });
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'needs-you', statusSince: 4 })], remove: [] });
    expect(drawerToggle()).toHaveAttribute('aria-expanded', 'true'); // needs you again: opens
  });

  it('VIEW-2.3 / VIEW-5.2: a Session that is not Controllable is read-only, with no preview or composer, and says why', async () => {
    const app = renderApp('/s/orca');
    app.snapshot([row({ id: 'orca', backend: 'unknown', controllable: false, status: 'needs-you' })]);
    expect(screen.queryByRole('button', { name: /Terminal/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.getByText('View only: this Session runs in another app')).toBeInTheDocument();
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'orca', false));
  });

  it('VIEW-5.3: when the Session ends, the composer and preview are replaced by "This Session ended"', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', title: 'fix-rates', status: 'needs-you' })]);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Terminal/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('fix-rates');
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
  });
});

describe('composer', () => {
  it('VIEW-3.1: Enter sends; Shift+Enter adds a line', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(box).toHaveValue('Line one\nLine two');
    expect(app.client.sendMessage).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'Line one\nLine two');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('VIEW-3.4: if sending fails, the text stays and the error shows', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a', {
      sendMessage: async () => {
        throw new SaveError("Couldn't send: session has no terminal handle");
      },
    });
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'Reply with OK{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send: session has no terminal handle");
    expect(box).toHaveValue('Reply with OK');
  });

  it.each([
    ['text', "The Session's input box already holds text, so nothing was sent. Send or clear it in the terminal, then try again.", null],
    ['prompt', 'The Session is waiting on a prompt, so nothing was sent. Answer it, then try again.', ESC_POINTER.prompt],
    ['no_input_box', "The Session's input box isn't on screen (a panel, a menu or the transcript view is open), so nothing was sent. Press Esc to close it, then try again.", ESC_POINTER.no_input_box],
    ['unreadable', "Fleet can't read the Session's input box, so nothing was sent. Send it from the terminal instead.", null],
  ] as const)('VIEW-3.7: a send held for `%s` keeps the text, shows why where a failed send’s error goes, drops the dimmed message, and points to Esc while it shows', async (why, message, pointer) => {
    const user = userEvent.setup();
    const held = new SaveError(message, null, 409, { kind: 'send_held', reason: why });
    let refuse: () => void = () => {};
    const sendMessage = vi.fn(() => new Promise<void>((_, reject) => (refuse = () => reject(held))));
    const app = renderApp('/s/a', { sendMessage });
    // `/usage` left its panel open: the Session Needs you, and the server's read of this spell shows nothing Lookout answers.
    app.snapshot([row({ id: 'a', status: 'needs-you', statusSince: 1_000, waitingFor: 'dialog open' })]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', entries: [], before: null, queue: [] });
    app.emit({ type: 'prompt', sessionId: 'a', prompt: null, epoch: 1, uncertain: null, since: 1_000 });
    expect(within(header()).getByRole('button', { name: 'Esc' })).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'Reply with OK{Enter}');
    // On its way, dimmed in the chat (VIEW-1.13); held, it goes.
    expect(document.querySelector('[data-echo]')).toHaveTextContent('Reply with OK');
    await act(async () => refuse());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(pointer ? `${message} ${pointer}` : message);
    expect(box).toHaveValue('Reply with OK');
    expect(document.querySelector('[data-echo]')).toBeNull();
    // The Esc button goes (the panel closed): so does the pointer, the message stays.
    app.emit({ type: 'sessions', upsert: [row({ id: 'a', status: 'idle', statusSince: 2_000 })], remove: [] });
    expect(within(header()).queryByRole('button', { name: 'Esc' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(message);
  });

  it('VIEW-3.5: each Session keeps its own unsent draft while switching', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' }), row({ id: 'b' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft for a');
    await user.click(rowEl('b'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft for b');
    await user.click(rowEl('a'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft for a');
    await user.click(rowEl('b'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft for b');
  });

  it('VIEW-3.6 (support): `i` focuses the composer outside text fields; Esc leaves it', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.keyboard('i');
    expect(box).toHaveFocus();
    expect(box).toHaveValue(''); // the `i` itself isn't typed
    await user.keyboard('{Escape}');
    expect(box).not.toHaveFocus();

    await user.click(screen.getByRole('searchbox', { name: 'Filter Sessions' }));
    await user.keyboard('i');
    expect(box).not.toHaveFocus();
  });

  it('switching Sessions points the server at the new one', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await user.click(rowEl('b'));
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'b', false));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', null, false));
  });

  it('VIEW-2.2: opening a Session that Needs you asks for its preview straight away, never for no preview first', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'needs-you' })]);
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    expect(vi.mocked(app.client.watch).mock.calls).not.toContainEqual(['tab-1', 'a', false]);
  });

  it('coming back from Settings asks for exactly the drawer state shown', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    await user.click(screen.getByRole('button', { name: /Terminal/ })); // drawer open…
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    await user.click(screen.getByRole('button', { name: 'Settings' })); // …then away
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', null, false));
    vi.mocked(app.client.watch).mockClear();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    const shown = screen.getByRole('button', { name: /Terminal/ }).getAttribute('aria-expanded') === 'true';
    expect(vi.mocked(app.client.watch).mock.calls).toEqual([['tab-1', 'a', shown]]);
  });

  it('VIEW-3.4: text typed while a send is in flight survives its success', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const app = renderApp('/s/a', { sendMessage: () => new Promise<void>((r) => (finish = r)) });
    app.snapshot([row({ id: 'a' })]);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'first{Enter}');
    await user.type(box, ' and more');
    await act(async () => finish());
    expect(box).toHaveValue('first and more');
  });

  it('VIEW-3.4: a send in flight isn’t sent again after switching away and back', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const app = renderApp('/s/a', { sendMessage: () => new Promise<void>((r) => (finish = r)) });
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'once{Enter}');
    await user.click(rowEl('b'));
    await user.click(rowEl('a'));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  });

  it('VIEW-3.4: a send that fails after switching away and back still shows its error', async () => {
    const user = userEvent.setup();
    let fail: (e: Error) => void = () => {};
    const app = renderApp('/s/a', { sendMessage: () => new Promise<void>((_, reject) => (fail = reject)) });
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello{Enter}');
    await user.click(rowEl('b'));
    await user.click(rowEl('a'));
    await act(async () => fail(new SaveError("Couldn't send: the Session host refused the message.")));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send: the Session host refused the message.");
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello');

    // Editing clears it.
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '!');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('VIEW-3.5: a Codex Session’s draft and drawer state follow it when it gets its session id', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/codex%3A42');
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex', status: 'busy' })]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'half-typed');
    await user.click(screen.getByRole('button', { name: /Terminal/ })); // open it by hand
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex', status: 'busy' })], remove: ['codex:42'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-1'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('half-typed');
    expect(screen.getByRole('button', { name: /Terminal/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a reconnect (new event stream) says again what the tab views', async () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a' })]);
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', false));
    await act(async () =>
      app.emit({ type: 'snapshot', sessions: [row({ id: 'a' })], fleet: { state: 'ok' }, settings: settings(), launches: [], started: [], clientId: 'tab-9', usage: null, memory: null }),
    );
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-9', 'a', false));
  });
});

describe('Session view colours (design system)', () => {
  it("DS-3.1: the main pane's header keeps the Harness logo's brand colour", () => {
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', harness: 'claude', status: 'busy' })]);
    const logo = within(header()).getByRole('img', { name: 'Claude Code' });
    expect(logo).toHaveAttribute('data-tone', 'brand');
    expect(logo.getAttribute('fill')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('DS-3.3: the terminal preview\'s "… · retrying" is in the info tone, not amber', async () => {
    const user = userEvent.setup();
    const app = renderApp('/s/a');
    app.snapshot([row({ id: 'a', status: 'busy' })]);
    await user.click(drawerToggle());
    await waitFor(() => expect(app.client.watch).toHaveBeenLastCalledWith('tab-1', 'a', true));
    app.emit({ type: 'preview', sessionId: 'a', text: 'x', error: 'Preview failed: no such pane' });
    const retrying = within(drawerToggle()).getByText('Preview failed: no such pane · retrying');
    expect(retrying).toHaveClass('text-info-text');
    expect([...retrying.classList].filter((c) => c.includes('needs-you'))).toEqual([]);
  });
});
