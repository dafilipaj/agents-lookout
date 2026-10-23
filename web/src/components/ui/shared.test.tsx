import { act, fireEvent, render, screen } from '@testing-library/react';
import { Plus, WifiOff } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ClockContext } from '@/lib/time';
import { Alert } from './alert';
import { Chip } from './chip';
import { CommandBlock } from './command-block';
import { EmptyState } from './empty-state';
import { IconButton, RowAction, RowSettling } from './icon-button';
import { Kbd } from './kbd';
import { Loading } from './loading';
import { SessionMarker } from './session-marker';

/** The lucide icon an element draws (`lucide-circle-x` → `circle-x`). */
const icon = (el: Element) => [...(el.querySelector('svg')?.classList ?? [])].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon')?.slice('lucide-'.length);

describe('Alert', () => {
  it('DS-4.1: an error is role="alert" with CircleX in destructive; an info notice is role="status" with Info, or the icon it is given, in info-text', () => {
    render(
      <>
        <Alert title="Couldn't read PRs" detail="GitHub rate limit. In 12m." data-testid="error" />
        <Alert tone="info" title="Fleet isn't answering." data-testid="info" />
        <Alert tone="info" icon={WifiOff} title="Lost the Lookout server. Reconnecting…" data-testid="wifi" />
      </>,
    );
    const error = screen.getByTestId('error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(icon(error)).toBe('circle-x');
    expect(error.querySelector('svg')).toHaveClass('text-destructive');
    expect(error).toHaveClass('bg-destructive-soft', 'border-destructive/30');
    expect(error.querySelector('[data-slot="alert-title"]')).toHaveClass('text-destructive-text');
    const info = screen.getByTestId('info');
    expect(info).toHaveAttribute('role', 'status');
    expect(icon(info)).toBe('info');
    expect(info).toHaveClass('bg-info-soft', 'border-info-border', 'text-info-text');
    expect(info.querySelector('svg')).toHaveClass('text-info-text');
    expect(icon(screen.getByTestId('wifi'))).toBe('wifi-off');
  });

  it('DS-4.1: a box takes a title, a detail and children, its 14 px icon at the first line, all in meta', () => {
    render(
      <Alert title="Couldn't read PRs" detail="GitHub rate limit." data-testid="box">
        <button type="button">Refresh</button>
      </Alert>,
    );
    const box = screen.getByTestId('box');
    expect(box).toHaveAttribute('data-layout', 'box');
    expect(box).toHaveClass('rounded-md', 'border', 'px-2.5', 'py-2', 'text-meta');
    expect(box.querySelector('svg')).toHaveClass('size-3.5');
    expect(box.querySelector('[data-slot="alert-title"]')).toHaveTextContent("Couldn't read PRs");
    expect(box.querySelector('[data-slot="alert-title"]')).toHaveClass('font-medium');
    expect(box.querySelector('[data-slot="alert-detail"]')).toHaveTextContent('GitHub rate limit.');
    expect(box).toContainElement(screen.getByRole('button', { name: 'Refresh' }));
  });

  it('DS-4.1: inline is a meta line that wraps, with a 12 px icon at its first line and no cut-short text', () => {
    const long = "Couldn't send: the Session ended before the message reached it, so nothing was typed.";
    render(<Alert layout="inline" title={long} data-testid="inline" />);
    const inline = screen.getByTestId('inline');
    expect(inline).toHaveAttribute('role', 'alert');
    expect(inline).toHaveClass('text-meta', 'text-destructive-text', 'items-start');
    expect(inline.querySelector('svg')).toHaveClass('size-3');
    expect(inline.querySelector('[class*="truncate"]')).toBeNull();
    expect(screen.getByText(long)).toHaveClass('break-words');
    expect(inline).not.toHaveAttribute('title');
  });

  it('DS-4.1: inline with oneLine is one line, cut short, with the whole text in its tooltip', () => {
    const long = "Couldn't switch the model: Fleet didn't answer before the Session moved on.";
    render(<Alert layout="inline" oneLine title={long} data-testid="inline" />);
    const inline = screen.getByTestId('inline');
    expect(inline).toHaveAttribute('title', long);
    expect(inline.querySelector('.truncate')).toHaveTextContent(long);
  });

  it('DS-4.1: quiet is the same look without a live role; presentation takes the role off too', () => {
    render(
      <>
        <Alert layout="inline" title="Loud" data-testid="loud" />
        <Alert layout="inline" quiet title="Quiet" data-testid="quiet" />
        <Alert tone="info" role="presentation" title="Silent" data-testid="silent" />
      </>,
    );
    expect(screen.getByTestId('loud')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('quiet')).not.toHaveAttribute('role');
    expect(screen.getByTestId('quiet')).toHaveClass('text-meta', 'text-destructive-text');
    expect(screen.getByTestId('quiet').querySelector('svg')).toHaveClass('size-3', 'text-destructive');
    expect(screen.getByTestId('silent')).toHaveAttribute('role', 'presentation');
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
  });
});

describe('Session marker', () => {
  it('DS-5.1: live, the Status marker; past and resumable, History in muted-foreground; past and blocked, CircleSlash', () => {
    render(
      <>
        <SessionMarker state="live" status="needs-you" data-testid="live" />
        <SessionMarker state="past" data-testid="past" />
        <SessionMarker state="blocked" data-testid="blocked" />
        <SessionMarker state="live" status="busy" className="size-4.5" data-testid="sidebar" />
      </>,
    );
    const live = screen.getByTestId('live');
    expect(live).toHaveAttribute('data-session-marker');
    expect(live).toHaveAttribute('data-state', 'live');
    expect(live).toHaveAttribute('data-status', 'needs-you');
    expect(live.querySelector('[role="img"][data-status="needs-you"]')).toHaveAccessibleName('Needs you');
    expect(screen.getByTestId('past')).toHaveAttribute('data-state', 'past');
    expect(screen.getByTestId('past')).not.toHaveAttribute('data-status');
    expect(screen.getByTestId('past').querySelector('svg')).toHaveClass('lucide-history');
    expect(screen.getByTestId('past').querySelector('svg')).toHaveClass('text-muted-foreground');
    expect(icon(screen.getByTestId('blocked'))).toBe('circle-slash');
    // The box is the list's: 14 px by default, the sidebar's 18 px when it says so.
    expect(live).toHaveClass('size-3.5');
    expect(screen.getByTestId('sidebar')).toHaveClass('size-4.5');
    expect(screen.getByTestId('sidebar')).not.toHaveClass('size-3.5');
  });
});

describe('Loading', () => {
  /** Loading on the app's clock, which the test moves by re-rendering with a later time. */
  function clocked(start: number, props: Parameters<typeof Loading>[0]) {
    const view = (now: number) => (
      <ClockContext.Provider value={now}>
        <Loading {...props} />
      </ClockContext.Provider>
    );
    const { rerender } = render(view(start));
    return (now: number) => act(() => rerender(view(now)));
  }

  it('DS-6.1: the label at once in a polite status; from 3 s the seconds after it, outside that status; from 15 s the hint', () => {
    const T = 1_000_000;
    const at = clocked(T, { label: 'Reading the Transcript…', hint: 'This is taking a while.', action: <button type="button">Show terminal</button> });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Reading the Transcript…');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText(/· \d+s/)).toBeNull();
    at(T + 2_999);
    expect(document.querySelector('[data-field="elapsed"]')).toBeNull();
    at(T + 4_000);
    const elapsed = document.querySelector('[data-field="elapsed"]')!;
    expect(elapsed).toHaveTextContent('· 4s');
    expect(status).not.toContainElement(elapsed as HTMLElement); // the seconds aren't announced every second
    expect(screen.getByRole('status')).toHaveTextContent(/^Reading the Transcript…$/);
    expect(screen.queryByText('This is taking a while.')).toBeNull();
    at(T + 15_000);
    expect(screen.getByText('This is taking a while.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show terminal' })).toBeInTheDocument();
    expect(elapsed).toHaveTextContent('· 15s');
  });

  it('DS-6.1: it counts from `since` when given, and shows no hint where the place gives none', () => {
    const T = 2_000_000;
    clocked(T, { label: 'Loading…', since: T - 20_000 });
    expect(document.querySelector('[data-field="elapsed"]')).toHaveTextContent('· 20s');
    expect(document.querySelector('[data-field="hint"]')).toBeNull();
    expect(screen.getByRole('status').closest('[data-slot="loading"]')).toHaveClass('text-meta', 'text-muted-foreground');
  });

  it('DS-6.1: it keeps no timer of its own', () => {
    const setInterval = vi.spyOn(window, 'setInterval');
    const setTimeout = vi.spyOn(window, 'setTimeout');
    render(<Loading label="Loading…" />);
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('IconButton', () => {
  it('DS-7.1: sm is a 24 px box with a 14 px icon, md a 28 px box with a 16 px icon; its name is required and its tooltip says the same, with the key', () => {
    render(
      <>
        <IconButton label="Dismiss">
          <Plus />
        </IconButton>
        <IconButton size="md" label="Close History" shortcut="H">
          <Plus />
        </IconButton>
        <IconButton size="md" label="Refresh" tip="Refreshing…">
          <Plus />
        </IconButton>
      </>,
    );
    const sm = screen.getByRole('button', { name: 'Dismiss' });
    expect(sm).toHaveClass('size-6', "[&_svg:not([class*='size-'])]:size-3.5", 'text-muted-foreground');
    expect(sm).not.toHaveClass('size-7', "[&_svg:not([class*='size-'])]:size-4");
    expect(sm).toHaveAttribute('title', 'Dismiss');
    expect(sm).toHaveAttribute('type', 'button');
    const md = screen.getByRole('button', { name: 'Close History' });
    expect(md).toHaveClass('size-7', "[&_svg:not([class*='size-'])]:size-4");
    expect(md).toHaveAttribute('title', 'Close History (H)');
    expect(md).toHaveAttribute('data-slot', 'icon-button');
    // Ghost: the accent under the pointer, the Button's focus ring.
    expect(md).toHaveClass('hover:bg-accent', 'focus-visible:ring-[3px]');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('title', 'Refreshing…');
  });

  it('DS-7.1: the labelled size is a word beside a 20 px icon in a 28 px tall target; its word is its name, its tooltip has the key, and a press never reaches the row', () => {
    const pressed: string[] = [];
    render(
      <div role="listbox" aria-label="Rows" onClick={() => pressed.push('row')}>
        <div role="option" aria-selected>
          <RowAction label="Open in Fantastic" icon={<Plus />} tip="Open in Fantastic (O)" onPress={() => pressed.push('open')} />
          <RowAction label="Resuming…" icon={<Plus />} tip="Resume" enabled={false} onPress={() => pressed.push('resume')} />
        </div>
      </div>,
    );
    const open = screen.getByRole('button', { name: 'Open in Fantastic' });
    expect(open).toHaveClass('h-7', 'px-2', 'text-body', "[&_svg:not([class*='size-'])]:size-5", '[&>svg]:size-5', 'border', 'hover:bg-accent');
    expect(open).not.toHaveClass('size-6', 'size-7');
    expect(open).toHaveAttribute('title', 'Open in Fantastic (O)');
    expect(open).not.toHaveAttribute('tabindex');
    fireEvent.click(open);
    expect(pressed).toEqual(['open']);
    const waiting = screen.getByRole('button', { name: 'Resuming…' });
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(waiting);
    expect(pressed).toEqual(['open']);
  });

  it('WORK-1.12, HIST-3.5: a labelled button ignores the second click of a double click, and every press while its row settles, saying it’s disabled without looking it', () => {
    const pressed: string[] = [];
    const { rerender } = render(
      <RowSettling.Provider value={false}>
        <RowAction label="Resume" icon={<Plus />} tip="Resume" onPress={() => pressed.push('resume')} />
      </RowSettling.Provider>,
    );
    const button = screen.getByRole('button', { name: 'Resume' });
    fireEvent.click(button, { detail: 2 });
    fireEvent.click(button, { detail: 3 });
    expect(pressed).toEqual([]);
    fireEvent.click(button, { detail: 1 });
    expect(pressed).toEqual(['resume']);
    rerender(
      <RowSettling.Provider value>
        <RowAction label="Resume" icon={<Plus />} tip="Resume" onPress={() => pressed.push('resume')} />
      </RowSettling.Provider>,
    );
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveClass('opacity-50');
    fireEvent.click(button, { detail: 1 });
    expect(pressed).toEqual(['resume']);
  });
});

describe('shared pieces', () => {
  it('DS-8.1: EmptyState is centred: the title in body medium, the hint in meta muted, a 20 px icon above and an action below', () => {
    render(<EmptyState title="No messages yet" hint="The conversation shows here once it starts." icon={Plus} action={<button type="button">Start</button>} data-testid="empty" />);
    const empty = screen.getByTestId('empty');
    expect(empty).toHaveClass('items-center', 'text-center');
    expect(screen.getByText('No messages yet')).toHaveClass('text-body', 'font-medium');
    expect(screen.getByText('The conversation shows here once it starts.')).toHaveClass('text-meta', 'text-muted-foreground');
    expect(empty.querySelector('svg')).toHaveClass('size-5');
    expect(empty.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(empty.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Start' }));
  });

  it('DS-8.2: CommandBlock is monospace caption, wrapped anywhere, and selected whole on click', async () => {
    render(<CommandBlock>cargo install --git https://github.com/dafilipaj/fleet --branch lookout fleet</CommandBlock>);
    const block = screen.getByText(/cargo install/);
    expect(block.tagName.toLowerCase()).toBe('pre');
    expect(block).toHaveClass('font-mono', 'text-caption', 'whitespace-pre-wrap', '[overflow-wrap:anywhere]', 'select-all');
    // The whole-block selection is the `select-all` class: jsdom doesn't select through CSS, so the class is the check.
  });

  it('DS-8.3: Chip is one pill in caption medium, with a tone: neutral, info or a Status', () => {
    render(
      <>
        <Chip>live</Chip>
        <Chip tone="info">old</Chip>
        <Chip tone="needs-you">Needs you</Chip>
        <Chip tone="busy">Busy</Chip>
      </>,
    );
    for (const text of ['live', 'old', 'Needs you', 'Busy']) expect(screen.getByText(text)).toHaveClass('rounded-full', 'px-1.5', 'text-caption', 'font-medium', 'leading-4');
    expect(screen.getByText('live')).toHaveClass('bg-muted', 'text-foreground');
    expect(screen.getByText('old')).toHaveClass('bg-info-soft', 'text-info-text');
    expect(screen.getByText('Needs you')).toHaveClass('bg-needs-you-soft', 'text-needs-you-text');
    expect(screen.getByText('Busy')).toHaveClass('bg-busy-soft', 'text-busy-text');
  });

  it('DS-8.4: Kbd is one key: caption monospace, bordered, at least 20 px wide', () => {
    render(<Kbd>Esc</Kbd>);
    const key = screen.getByText('Esc');
    expect(key.tagName.toLowerCase()).toBe('kbd');
    expect(key).toHaveClass('font-mono', 'text-caption', 'rounded', 'border', 'border-border', 'px-1', 'min-w-5');
  });
});
