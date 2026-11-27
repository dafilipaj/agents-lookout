import { PRIVATE_FOLDER_ERROR } from '@shared/private-folders.ts';
import { PRIVATE_NEEDS_VAULT } from '@shared/settings.ts';
import { PRIVATE_IDLE } from '@/components/VaultSettings';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { LibraryPage, OutputItem } from '@shared/library.ts';
import { parseRoute, routePath } from '@/lib/router';
import { SaveError } from '@/lib/client';
import { renderApp, settings } from '@/test/helpers';

const vaultCard = () => screen.getByLabelText('Vault folder').closest('form')!;
const privateCard = () => screen.getByRole('heading', { name: 'Private folders' }).closest('section')!;
const privateList = () => within(privateCard()).queryByRole('list', { name: 'Private folders' });
const entries = () => (privateList() ? within(privateList()!).getAllByRole('listitem').map((li) => li.textContent) : []);

it('PEOPLE-1.1: Settings has a third section, Vault, at its own path, and its first card sets the Vault folder: Save, then "Saved" or "Cleared", and what the folder is for', async () => {
  const user = userEvent.setup();
  expect(parseRoute('/settings/vault')).toEqual({ name: 'settings', section: 'vault' });
  expect(routePath({ name: 'settings', section: 'vault' })).toBe('/settings/vault');

  const app = renderApp('/settings/vault');
  app.snapshot([]);
  const nav = screen.getByRole('navigation', { name: 'Settings' });
  expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['General', 'Tools', 'Vault']);
  expect(within(nav).getByRole('link', { name: 'Vault' })).toHaveAttribute('aria-current', 'page');

  // None is set by default, and the card says what the folder is for.
  const field = screen.getByLabelText('Vault folder');
  expect(field).toHaveValue('');
  expect(vaultCard()).toHaveTextContent('Lookout reads people and their notes from it.');
  // The section opens with it, above its cards.
  const opening = screen.getByText(/Lookout reads the Vault and never writes to it\./);
  expect(opening.compareDocumentPosition(vaultCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(vaultCard()).not.toContainElement(opening);
  expect(within(vaultCard()).getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.type(field, '~/Documents/notes/');
  await user.click(within(vaultCard()).getByRole('button', { name: 'Save' }));
  expect(app.saveSettings).toHaveBeenLastCalledWith({ vaultFolder: '~/Documents/notes' });
  await waitFor(() => expect(within(vaultCard()).getByRole('status')).toHaveTextContent('Saved'));
  expect(field).toHaveValue('~/Documents/notes');

  // An empty field clears it.
  await user.clear(field);
  await user.click(within(vaultCard()).getByRole('button', { name: 'Save' }));
  expect(app.saveSettings).toHaveBeenLastCalledWith({ vaultFolder: null });
  await waitFor(() => expect(within(vaultCard()).getByRole('status')).toHaveTextContent('Cleared'));
});

it('PEOPLE-1.1: what the server refuses is said in its words, and the saved folder stays', async () => {
  const user = userEvent.setup();
  const saveSettings = vi.fn(async () => {
    throw new SaveError('Not a directory: ~/nowhere', 'vaultFolder', 400);
  });
  const app = renderApp('/settings/vault', { saveSettings });
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/Documents/notes' }));
  const field = screen.getByLabelText('Vault folder');
  expect(field).toHaveValue('~/Documents/notes');
  await user.clear(field);
  await user.type(field, '~/nowhere');
  await user.click(within(vaultCard()).getByRole('button', { name: 'Save' }));
  expect(await within(vaultCard()).findByRole('alert')).toHaveTextContent('Not a directory: ~/nowhere');
  expect(within(vaultCard()).getByRole('status')).toBeEmptyDOMElement();
  expect(field).toHaveAttribute('aria-invalid', 'true');
});

it('PEOPLE-2.1: the second card lists the Private folders: add one inside the Vault or a full path, with `*` for a folder’s name, and remove one', async () => {
  const user = userEvent.setup();
  const app = renderApp('/settings/vault');
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/Documents/notes' }));
  // Empty by default: no list yet, and the card says what a Private folder does and how an entry reads.
  expect(privateList()).toBeNull();
  expect(privateCard()).toHaveTextContent('Lookout never lists or shows a file under these');
  expect(privateCard()).toHaveTextContent('Team/*/Reviews');

  const add = screen.getByLabelText('Folder to make private');
  await user.type(add, ' Team/*/Reviews/ ');
  await user.click(within(privateCard()).getByRole('button', { name: 'Add' }));
  expect(app.saveSettings).toHaveBeenLastCalledWith({ privateFolders: ['Team/*/Reviews'] });
  await waitFor(() => expect(entries()).toEqual(['Team/*/Reviews']));
  expect(add).toHaveValue('');

  await user.type(add, '~/work/output/reviews');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(entries()).toEqual(['Team/*/Reviews', '~/work/output/reviews']));

  await user.click(within(privateCard()).getByRole('button', { name: 'Remove Team/*/Reviews' }));
  expect(app.saveSettings).toHaveBeenLastCalledWith({ privateFolders: ['~/work/output/reviews'] });
  await waitFor(() => expect(entries()).toEqual(['~/work/output/reviews']));
});

it('PEOPLE-2.1: an entry the rule refuses is refused before it is sent, with the rule’s words; a repeat and a path inside a Vault that isn’t set too', async () => {
  const user = userEvent.setup();
  const app = renderApp('/settings/vault');
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: null, privateFolders: ['/srv/private'] }));
  const add = screen.getByLabelText('Folder to make private');
  const press = () => user.click(within(privateCard()).getByRole('button', { name: 'Add' }));
  const refused = async (typed: string, words: string) => {
    await user.clear(add);
    await user.type(add, typed);
    await press();
    expect(within(privateCard()).getByRole('alert')).toHaveTextContent(words);
  };
  await refused('Team/../Reviews', PRIVATE_FOLDER_ERROR);
  await refused('Team/**/Reviews', PRIVATE_FOLDER_ERROR);
  await refused('/srv/private/', 'That folder is already in the list.');
  await refused('Team/Reviews', PRIVATE_NEEDS_VAULT);
  expect(app.saveSettings).not.toHaveBeenCalled();
  // Typing again takes the words away.
  await user.type(add, 'x');
  expect(within(privateCard()).queryByRole('alert')).toBeNull();
  expect(entries()).toEqual(['/srv/private']);
});

it('PEOPLE-2.6: a change of the Private folders reads the Library again at once, while it shows', async () => {
  const user = userEvent.setup();
  const output: OutputItem = { kind: 'file', key: '/notes/a.html', type: 'html', title: 'A page', path: '/notes/a.html', url: null, display: '~/notes/a.html', projectPath: '/project', repo: 'project', createdAt: 1, updatedAt: 1, events: 1, exists: true, sessions: [], sourcePath: null, source: null, version: null } as unknown as OutputItem;
  const page: LibraryPage = { state: 'ok', items: [output], readId: 'read-1', total: 1, nextPage: 2, hasMore: false, hiddenGone: 0, unfilteredEmpty: false, projects: ['/project'] };
  const library = vi.fn(async () => page);
  const app = renderApp('/settings/vault', { library });
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/Documents/notes' }));
  fireEvent.keyDown(document.body, { key: 'l' });
  await waitFor(() => expect(library).toHaveBeenCalled());
  await waitFor(() => expect(within(within(screen.getByTestId('library-panel')).getByRole('listbox', { name: 'Outputs' })).getAllByRole('option')).toHaveLength(1));
  const before = library.mock.calls.length;

  await user.type(screen.getByLabelText('Folder to make private'), 'Team/*/Reviews');
  await user.click(within(privateCard()).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(library.mock.calls.length).toBeGreaterThan(before));
});

it('PEOPLE-2.10: with a path inside the Vault and no Vault folder, as only a settings file edited by hand leaves it, the card says those entries hide nothing', () => {
  const app = renderApp('/settings/vault');
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: null, privateFolders: ['Team/*/Reviews', '/srv/private'] }));
  expect(entries()).toEqual(['Team/*/Reviews', '/srv/private']);
  expect(within(privateCard()).getByText(PRIVATE_IDLE)).toBeInTheDocument();

  // With the Vault folder set, or with full paths only, every entry hides what it says.
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews', '/srv/private'] }));
  expect(within(privateCard()).queryByText(PRIVATE_IDLE)).not.toBeInTheDocument();
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: null, privateFolders: ['/srv/private'] }));
  expect(within(privateCard()).queryByText(PRIVATE_IDLE)).not.toBeInTheDocument();
});

it('PEOPLE-2.6: an open Document view asks the server again when what is private changes, and then says only that it can’t show the file', async () => {
  // An invented note: the repo is public.
  const review = '/Users/me/notes/Team/Tomo/Reviews/q3.md';
  let hidden = false;
  const answer = vi.fn(async () => {
    if (hidden) throw new SaveError("Lookout can't show this file.", null, 404);
    return { path: review, display: '~/notes/Team/Tomo/Reviews/q3.md', type: 'markdown' as const, exists: true };
  });
  const app = renderApp(routePath({ name: 'doc', path: review }), { document: answer, documentText: async () => ({ text: '# Q3 review\n\nKeep this off the screen.', truncated: false }) });
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/notes' }));
  expect(await screen.findByText('Keep this off the screen.')).toBeVisible();
  const asked = answer.mock.calls.length;

  // The folder is made private, in this tab or another: the settings reach every tab.
  hidden = true;
  app.snapshot([], { state: 'ok' }, settings({ vaultFolder: '~/notes', privateFolders: ['Team/*/Reviews'] }));
  await waitFor(() => expect(answer.mock.calls.length).toBeGreaterThan(asked));
  await waitFor(() => expect(screen.queryByText('Keep this off the screen.')).not.toBeInTheDocument());
  expect(document.querySelector('[data-view="document"] [data-field="unavailable"]')).toHaveTextContent("Lookout can't show this file.");
});
