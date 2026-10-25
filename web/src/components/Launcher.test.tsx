import type { LaunchRequest } from '@shared/types.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { HARNESSES, launchView, renderApp, row, settings } from '@/test/helpers';

async function openLauncher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New Session' }));
  return screen.findByRole('dialog');
}

const harnessRadio = (name: RegExp) => screen.getByRole('radio', { name });

describe('the launcher', () => {
  it('LAUNCH-1.1 (support): N opens it, but not while typing in a text field', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'a' })]);
    await user.keyboard('n');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveFocus());
    await user.keyboard('n'); // typed into the prompt, not another open
    expect(screen.getByLabelText('Prompt')).toHaveValue('n');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('searchbox', { name: 'Filter Sessions' }));
    await user.keyboard('n');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Filter Sessions' })).toHaveValue('n');
  });

  it('LAUNCH-1.1 (support): the "+" button and ⌘N open it with the cursor in the prompt', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    await openLauncher(user);
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.keyboard('{Meta>}n{/Meta}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('LAUNCH-1.2: it starts with the Harness, model and start directory used last', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot(
      [],
      { state: 'ok' },
      settings({
        startDirectories: ['~/Projects/work', '~/Projects/agents-lookout'],
        lastLaunch: { harness: 'codex', model: 'gpt-6-astra', directory: '~/Projects/agents-lookout' },
      }),
    );
    await openLauncher(user);
    await waitFor(() => expect(screen.getByLabelText('Model')).not.toBeDisabled());
    expect(harnessRadio(/Codex/)).toBeChecked();
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-6-astra');
    expect(screen.getByLabelText('Directory')).toHaveValue('~/Projects/agents-lookout');
  });

  it('LAUNCH-1.3 (support): Esc closes it, and reopening restores what was typed', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    await openLauncher(user);
    await user.type(screen.getByLabelText('Name'), 'fix-rates');
    await user.type(screen.getByLabelText('Prompt'), 'Look at the rates');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openLauncher(user);
    expect(screen.getByLabelText('Name')).toHaveValue('fix-rates');
    expect(screen.getByLabelText('Prompt')).toHaveValue('Look at the rates');
  });

  it('LAUNCH-2.1: the start directory is picked from the Settings list, ~/Projects/work by default', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([], { state: 'ok' }, settings({ startDirectories: ['~/Projects/work', '/tmp/scratch'] }));
    await openLauncher(user);
    const select = screen.getByLabelText('Directory');
    expect(select).toHaveValue('~/Projects/work');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['~/Projects/work', '/tmp/scratch']);
  });

  it('LAUNCH-3.1: Claude Code is the default; a Harness that is not installed is shown disabled', async () => {
    const user = userEvent.setup();
    const app = renderApp('/', {
      harnesses: async () => [HARNESSES[0]!, { ...HARNESSES[1]!, installed: false }],
    });
    app.snapshot([]);
    await openLauncher(user);
    await waitFor(() => expect(harnessRadio(/Codex/)).toBeDisabled());
    expect(harnessRadio(/Claude Code/)).toBeChecked();
    expect(screen.getByText('not installed')).toBeInTheDocument();
    // Each choice shows its Harness's mark.
    const group = screen.getByRole('radiogroup', { name: 'Harness' });
    expect(within(group).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Claude Code', 'Codex']);
  });

  it('LAUNCH-3.2: the models are the ones Fleet lists for the chosen Harness, defaulting to its own default', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    await openLauncher(user);
    const model = screen.getByLabelText('Model');
    await waitFor(() => expect(model).not.toBeDisabled());
    expect(model).toHaveValue('');
    expect(within(model).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default', 'Opus 5.5', 'Sonnet 5.5']);
    await user.click(harnessRadio(/Codex/));
    expect(within(model).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default (gpt-6-astra)', 'GPT-6 Astra']);
    expect(model).toHaveValue('');
  });

  it('LAUNCH-3.4 LAUNCH-3.5: first starts use high and Harness-specific permissions; edits survive model changes and reopening', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    await openLauncher(user);
    const effort = await screen.findByLabelText('Effort');
    expect(effort).toHaveValue('high');
    expect(within(effort).getAllByRole('option').map((o) => o.textContent)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    const skip = screen.getByRole('checkbox', { name: 'Skip permissions' });
    expect(skip).toBeChecked();
    expect(skip.closest('label')).toHaveAttribute('title', 'Starts Claude Code with --dangerously-skip-permissions: no permission prompts.');
    await user.selectOptions(effort, 'max');
    await user.selectOptions(screen.getByLabelText('Model'), 'claude-sonnet-5-5');
    expect(effort).toHaveValue('max');
    await user.click(skip);
    await user.click(harnessRadio(/Codex/));
    expect(effort).toHaveValue('high');
    expect(skip).not.toBeChecked();
    expect(skip).toHaveAccessibleDescription("Also turns off Codex's sandbox");
    expect(skip.closest('label')?.title).toContain('--dangerously-bypass-approvals-and-sandbox');
    await user.click(harnessRadio(/Claude Code/));
    expect(effort).toHaveValue('max');
    expect(skip).not.toBeChecked();
    await user.keyboard('{Escape}');
    await openLauncher(user);
    expect(screen.getByLabelText('Effort')).toHaveValue('max');
    expect(screen.getByRole('checkbox', { name: 'Skip permissions' })).not.toBeChecked();
  });

  it('LAUNCH-3.4: remembered levels fall back to high then the model default, and models without levels omit Effort', async () => {
    const user = userEvent.setup();
    const harnesses = structuredClone(HARNESSES);
    harnesses[0]!.models.push(
      { id: 'small', label: 'Small', efforts: ['low', 'medium'], defaultEffort: 'medium' },
      { id: 'plain', label: 'Plain', efforts: [], defaultEffort: null },
    );
    const launch = vi.fn(async (_req: LaunchRequest) => launchView({ id: 'l-1' }));
    const app = renderApp('/', { harnesses: async () => harnesses, launch });
    app.snapshot([], { state: 'ok' }, settings({ lastLaunch: {
      harness: 'claude', model: '', directory: '~/Projects/work',
      byHarness: { claude: { effort: 'ultra', skipPermissions: false }, codex: { effort: 'low', skipPermissions: true } },
    } }));
    await openLauncher(user);
    expect(await screen.findByLabelText('Effort')).toHaveValue('high');
    await user.selectOptions(screen.getByLabelText('Model'), 'small');
    expect(screen.getByLabelText('Effort')).toHaveValue('medium');
    await user.selectOptions(screen.getByLabelText('Model'), '');
    expect(screen.getByLabelText('Effort')).toHaveValue('medium');
    await user.click(harnessRadio(/Codex/));
    expect(screen.getByLabelText('Effort')).toHaveValue('low');
    expect(screen.getByRole('checkbox', { name: 'Skip permissions' })).toBeChecked();
    await user.click(harnessRadio(/Claude Code/));
    await user.selectOptions(screen.getByLabelText('Model'), 'plain');
    expect(screen.queryByLabelText('Effort')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Start/ }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ model: 'plain', skipPermissions: false }), expect.any(String));
    expect(launch.mock.calls[0]![0]).not.toHaveProperty('effort');
  });

  it('LAUNCH-3.3: name and prompt are optional, and the prompt takes several lines', async () => {
    const user = userEvent.setup();
    const launch = vi.fn(async (req: LaunchRequest) => launchView({ id: 'l-1', title: req.name || 'x' }));
    const app = renderApp('/', { launch });
    app.snapshot([]);
    await openLauncher(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start/ })).toBeEnabled());

    await user.type(screen.getByLabelText('Prompt'), 'Line one: say OK.{Enter}Line two: say DONE.');
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // Enter made a new line, didn't start
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(launch).toHaveBeenCalledWith({
      directory: '~/Projects/work',
      harness: 'claude',
      model: '',
      effort: 'high',
      skipPermissions: true,
      name: '',
      prompt: 'Line one: say OK.\nLine two: say DONE.',
    }, expect.any(String));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Nothing typed at all is fine too.
    await openLauncher(user);
    expect(screen.getByLabelText('Prompt')).toHaveValue(''); // a successful start clears the draft
    await user.click(screen.getByRole('button', { name: /Start/ }));
    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ name: '', prompt: '' }), expect.any(String));
  });

  it('LAUNCH-4.4: if starting fails, the launcher stays open, shows the error and keeps the input', async () => {
    const user = userEvent.setup();
    const app = renderApp('/', {
      launch: async () => {
        throw new SaveError("Couldn't start the Session: tmux session `fix-rates` already exists");
      },
    });
    app.snapshot([]);
    await openLauncher(user);
    await user.type(screen.getByLabelText('Name'), 'fix-rates');
    await user.type(screen.getByLabelText('Prompt'), 'Hello{Enter}there');
    await user.click(harnessRadio(/Codex/));
    await user.click(screen.getByRole('button', { name: /Start/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('fix-rates');
    expect(screen.getByLabelText('Prompt')).toHaveValue('Hello\nthere');
    expect(harnessRadio(/Codex/)).toBeChecked();
  });

  it('LAUNCH-4.4: a field error from the server marks that field', async () => {
    const user = userEvent.setup();
    const app = renderApp('/', {
      launch: async () => {
        throw new SaveError('The prompt is too long.', 'prompt');
      },
    });
    app.snapshot([]);
    await openLauncher(user);
    await user.type(screen.getByLabelText('Prompt'), 'long');
    await user.click(screen.getByRole('button', { name: /Start/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The prompt is too long.');
    expect(screen.getByLabelText('Prompt')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Prompt')).toHaveValue('long');
  });

  it('LAUNCH-4.2 (support): a "Starting…" row shows, selected, and once Fleet reports the Session it is selected', async () => {
    const user = userEvent.setup();
    const app = renderApp('/', { launch: async () => launchView({ id: 'l-1', title: 'fix-rates' }) });
    app.snapshot([row({ id: 'other' })]);
    await openLauncher(user);
    await user.click(screen.getByRole('button', { name: /Start/ }));
    app.emit({ type: 'launches', launches: [launchView({ id: 'l-1', title: 'fix-rates' })], started: [] });
    const starting = screen.getByRole('list', { name: 'Starting Sessions' });
    expect(starting).toHaveTextContent('fix-rates');
    expect(starting).toHaveTextContent('Starting…');
    expect(within(starting).getByRole('listitem')).toHaveAttribute('aria-current', 'true');
    expect(window.location.pathname).toBe('/l/l-1');

    app.emit({ type: 'sessions', upsert: [row({ id: 'new-session', title: 'fix-rates' })], remove: [] });
    app.emit({ type: 'launches', launches: [], started: [{ launchId: 'l-1', sessionId: 'new-session' }] });
    expect(screen.queryByRole('list', { name: 'Starting Sessions' })).toBeNull();
    await waitFor(() => expect(window.location.pathname).toBe('/s/new-session'));
  });

  it('LAUNCH-4.2 (support): the Session is selected even when Fleet reports it before the start request returns', async () => {
    const user = userEvent.setup();
    let respond: (v: ReturnType<typeof launchView>) => void = () => {};
    const app = renderApp('/', { launch: () => new Promise((resolve) => (respond = resolve)) });
    app.snapshot([row({ id: 'other' })]);
    await openLauncher(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Start/ }));
    // Completion first…
    app.emit({ type: 'sessions', upsert: [row({ id: 'new-session' })], remove: [] });
    app.emit({ type: 'launches', launches: [], started: [{ launchId: 'l-1', sessionId: 'new-session' }] });
    // …then the POST response.
    await act(async () => respond(launchView({ id: 'l-1' })));
    await waitFor(() => expect(window.location.pathname).toBe('/s/new-session'));
  });

  it('LAUNCH-4.2 (support): a start that completed while this tab was disconnected is still selected', async () => {
    const user = userEvent.setup();
    const app = renderApp('/', { launch: async () => launchView({ id: 'l-1' }) });
    app.snapshot([row({ id: 'other' })]);
    await openLauncher(user);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    app.connection(false);
    // The completion event was missed; the reconnect snapshot still carries the mapping.
    app.emit({
      type: 'snapshot',
      sessions: [row({ id: 'other' }), row({ id: 'new-session' })],
      fleet: { state: 'ok' },
      settings: settings(),
      launches: [],
      started: [{ launchId: 'l-1', sessionId: 'new-session' }],
      clientId: 'tab-2',
      usage: null, memory: null,
    });
    await waitFor(() => expect(window.location.pathname).toBe('/s/new-session'));
  });

  it('LAUNCH-4.5 (support): a start that failed shows the last lines of its terminal and can be dismissed', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([]);
    app.emit({
      type: 'launches',
      launches: [launchView({ id: 'l-9', title: 'stuck', state: 'failed', error: "Fleet hasn't reported it after 15 s.", terminal: ['Trust this folder?', '› 1. Trust and continue'] })],
      started: [],
    });
    expect(screen.getByLabelText('Last lines of its terminal')).toHaveTextContent('Trust this folder? › 1. Trust and continue');
    await user.click(screen.getByRole('button', { name: 'Dismiss stuck' }));
    expect(app.client.dismissLaunch).toHaveBeenCalledWith('l-9');
  });

  it('keeps the sidebar’s shortcuts out of the launcher', async () => {
    const user = userEvent.setup();
    const app = renderApp();
    app.snapshot([row({ id: 'a' }), row({ id: 'b' })]);
    await openLauncher(user);
    await user.keyboard('{Meta>}2{/Meta}');
    expect(window.location.pathname).toBe('/');
  });
});
