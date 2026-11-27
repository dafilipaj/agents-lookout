import type { DocumentAnswer } from '@shared/library.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentView } from '@/components/DocumentView';
import { FILE_NOT_DOWNLOADED } from '@shared/library.ts';
import { SaveError } from '@/lib/client';
import { COPY_FEEDBACK_MS } from '@/lib/copy';
import { documentOf, isDocumentPath, showsInLookout } from '@/lib/outputs';
import { placeOfRoute } from '@/lib/places';
import { canGoBack, navigateTo, parseRoute, routePath } from '@/lib/router';
import { renderApp, row } from '@/test/helpers';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Invented paths throughout: the repo is public.
const NOTES = '/Users/me/harbor/output/tide notes.md';
const doc = (over: Partial<DocumentAnswer> = {}): DocumentAnswer => ({ path: NOTES, display: '~/harbor/output/tide notes.md', type: 'markdown', exists: true, vault: false, ...over });
const view = (over: Partial<Parameters<typeof DocumentView>[0]> = {}) => {
  const props = {
    path: NOTES,
    load: vi.fn(async () => doc()),
    loadText: vi.fn(async () => ({ text: '# Tide notes\n\nThe table is **ready**.', truncated: false })),
    onBack: vi.fn(),
    keyboardEnabled: true,
    ...over,
  };
  return { props, ...render(<DocumentView {...props} />) };
};
const main = () => document.querySelector<HTMLElement>('[data-view="document"]')!;

describe('the Document view’s paths (DOC-1.1, DOC-2.6)', () => {
  it('DOC-1.1: a file has its own path, alone or under the Session it was opened from; a path that isn’t absolute and plain is the start page', () => {
    expect(routePath({ name: 'doc', path: NOTES })).toBe('/doc/%2FUsers%2Fme%2Fharbor%2Foutput%2Ftide%20notes.md');
    expect(routePath({ name: 'doc', path: NOTES, session: 'a b' })).toBe('/s/a%20b/doc/%2FUsers%2Fme%2Fharbor%2Foutput%2Ftide%20notes.md');
    for (const route of [{ name: 'doc', path: NOTES } as const, { name: 'doc', path: NOTES, session: 'a b' } as const]) expect(parseRoute(routePath(route))).toEqual(route);
    for (const bad of ['notes.md', '~/notes.md', '/a/b:c.md', '/a/‮b.md', `/${'a'.repeat(1025)}.md`]) expect(parseRoute(`/doc/${encodeURIComponent(bad)}`)).toEqual({ name: 'home' });
    expect(parseRoute('/doc/%E0%A4%A')).toEqual({ name: 'home' });
    // A Session's own path is still its own.
    expect(parseRoute('/s/a')).toEqual({ name: 'session', id: 'a' });
  });

  it('DOC-1.1: the view shows a Markdown file, a page and an image, by the extension; a PDF, code and a file with none are not its', () => {
    for (const p of ['/a/notes.md', '/a/NOTES.MD', '/a/map.html', '/a/map.htm', '/a/shot.png', '/a/shot.JPEG', '/a/mark.svg', '/a/x.webp', '/a/x.gif']) expect(isDocumentPath(p), p).toBe(true);
    for (const p of ['/a/report.pdf', '/a/rates.ts', '/a/README', '/a/.md', '/a.md/readme']) expect(isDocumentPath(p), p).toBe(false);
    expect([showsInLookout('markdown'), showsInLookout('html'), showsInLookout('image'), showsInLookout('pdf'), showsInLookout(null)]).toEqual([true, true, true, false, false]);
    const item = { kind: 'file', exists: true, path: '/a/notes.md', type: 'markdown' } as Parameters<typeof documentOf>[0];
    expect(documentOf(item)).toBe('/a/notes.md');
    expect(documentOf({ ...item, exists: false })).toBeNull();
    expect(documentOf({ ...item, path: '/a/report.pdf', type: 'pdf' })).toBeNull();
    expect(documentOf({ ...item, kind: 'artifact', path: null, type: null, url: 'https://example.invalid/a' })).toBeNull();
  });

  it('DOC-2.6: a document at a Session’s path is Sessions’; one at /doc belongs to no place', () => {
    expect(placeOfRoute({ name: 'doc', path: NOTES, session: 'a' }, 'inbox')).toBe('sessions');
    expect(placeOfRoute({ name: 'doc', path: NOTES }, 'inbox')).toBe('inbox');
    expect(placeOfRoute({ name: 'doc', path: NOTES }, 'sessions')).toBe('sessions');
  });

  it('DOC-2.6: opened from a Session’s chat, that Session stays the selected row; from elsewhere the left column keeps the place you were in', async () => {
    const app = renderApp(routePath({ name: 'doc', path: NOTES, session: 'a' }), { document: async () => doc() });
    app.snapshot([row({ id: 'a', title: 'Tide tables' }), row({ id: 'b', title: 'Other work' })]);
    await waitFor(() => expect(within(main()).getByRole('heading', { name: 'tide notes.md' })).toBeVisible());
    expect(document.querySelector('[data-session-id="a"]')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[data-session-id="b"]')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: /^Sessions/ })).toHaveAttribute('aria-current', 'page');

    // From the Inbox, with no Session: the Inbox's list stays beside it, and Back returns there.
    act(() => navigateTo({ name: 'inbox' }));
    act(() => navigateTo({ name: 'doc', path: NOTES }));
    await waitFor(() => expect(within(main()).getByRole('heading', { name: 'tide notes.md' })).toBeVisible());
    expect(screen.getByRole('button', { name: /^Inbox/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('complementary', { name: 'Inbox' })).toBeVisible();
    fireEvent.click(within(main()).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(window.location.pathname).toBe('/inbox'));
  });
});

describe('the Document view (DOC-2)', () => {
  it('DOC-2.1: the header has Back, the file’s name with its Type’s icon, its Type word and its folder with the whole path as the tooltip, Open, and Copy path under More', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    view();
    const header = main().querySelector('header')!;
    expect(within(header).getByRole('button', { name: 'Back' })).toHaveAttribute('title', 'Back (Esc)');
    const title = await within(header).findByRole('heading', { name: 'tide notes.md' });
    await waitFor(() => expect(title.querySelector('svg')).not.toBeNull());
    const facts = header.querySelector('[data-field="facts"]')!;
    expect(facts).toHaveTextContent('Markdown·~/harbor/output');
    expect(facts.querySelector('[data-field="folder"]')).toHaveAttribute('title', '~/harbor/output/tide notes.md');
    const actions = [...header.querySelectorAll('[data-field="actions"] button')].map((b) => b.getAttribute('data-action'));
    expect(actions).toEqual(['open', 'more']);
    expect(header.querySelector('[data-variant="primary"]')).toBeNull();

    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    fireEvent.keyDown(within(header).getByRole('button', { name: 'More for tide notes.md' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    await act(async () => {});
    expect(write).toHaveBeenCalledWith(NOTES);
    expect(within(header).getByRole('status')).toHaveTextContent('Copied');
    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_MS));
    expect(within(header).getByRole('status')).toBeEmptyDOMElement();
    write.mockRejectedValueOnce(new Error('refused'));
    fireEvent.keyDown(within(header).getByRole('button', { name: 'More for tide notes.md' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    await act(async () => {});
    expect(within(header).getByRole('status')).toHaveTextContent("Couldn't copy");
  });

  it('DOC-2.2: Markdown is rendered, and says so when it was cut; a page is a sandboxed frame from the file route; an image is itself, no wider than the pane', async () => {
    const md = view({ loadText: vi.fn(async () => ({ text: '# Tide notes\n\nThe table is **ready**.', truncated: true })) });
    const region = await screen.findByRole('region', { name: 'tide notes.md' });
    expect(within(region).getByRole('heading', { name: 'Tide notes' })).toBeVisible();
    expect(region.querySelector('strong')).toHaveTextContent('ready');
    expect(region).toHaveAttribute('data-scroll-keys');
    expect(region.querySelector('[data-field="truncated"]')).toHaveTextContent('only its first megabyte is shown');
    expect(md.props.loadText).toHaveBeenCalledWith(NOTES);
    md.unmount();

    const page = view({ path: '/Users/me/harbor/output/map.html', load: vi.fn(async () => doc({ path: '/Users/me/harbor/output/map.html', display: '~/harbor/output/map.html', type: 'html' })) });
    const frame = await waitFor(() => main().querySelector('iframe')!);
    await waitFor(() => expect(main().querySelector('iframe')).not.toBeNull());
    expect(main().querySelector('iframe')).toHaveAttribute('src', '/api/library/file?path=%2FUsers%2Fme%2Fharbor%2Foutput%2Fmap.html&frame=1');
    expect(main().querySelector('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(main().querySelector('iframe')).toHaveAttribute('title', 'map.html');
    expect(page.props.loadText).not.toHaveBeenCalled();
    void frame;
    page.unmount();

    view({ path: '/Users/me/harbor/output/shot.png', load: vi.fn(async () => doc({ path: '/Users/me/harbor/output/shot.png', display: '~/harbor/output/shot.png', type: 'image' })) });
    await waitFor(() => expect(main().querySelector('img')).not.toBeNull());
    expect(main().querySelector('img')).toHaveAttribute('src', '/api/library/file?path=%2FUsers%2Fme%2Fharbor%2Foutput%2Fshot.png&frame=1');
    expect(main().querySelector('img')).toHaveClass('max-w-full');
  });

  it('DOC-2.3: it says it is reading, that a file no longer exists, and that Lookout can’t show one the server won’t read; neither has Open', async () => {
    let answer!: (d: DocumentAnswer) => void;
    const slow = view({ load: vi.fn(() => new Promise<DocumentAnswer>((r) => (answer = r))) });
    expect(within(main()).getByText('Reading the file…')).toBeVisible();
    await act(async () => answer(doc({ exists: false })));
    expect(main().querySelector('[data-field="gone"]')).toHaveTextContent('This file no longer exists.');
    expect(main().querySelector('[data-action="open"]')).toBeNull();
    slow.unmount();

    view({ load: vi.fn(async () => { throw new SaveError("Lookout can't show this file.", null, 404); }) });
    await waitFor(() => expect(main().querySelector('[data-field="unavailable"]')).not.toBeNull());
    expect(main().querySelector('[data-field="unavailable"]')).toHaveTextContent("Lookout can't show this file.");
    expect(main().querySelector('[data-field="unavailable"]')).toHaveTextContent('open it from the Library or from a path in a Session');
    expect(main().querySelector('[data-action="open"]')).toBeNull();
  });

  it('DOC-3.4: a file the server couldn’t fetch from the cloud says so in the server’s words, under the file’s own header, with Open still there', async () => {
    view({ loadText: vi.fn(async () => { throw new SaveError(FILE_NOT_DOWNLOADED, null, 503); }) });
    const alert = await within(main()).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't read this file");
    expect(alert).toHaveTextContent("kept in iCloud and isn't on this Mac");
    expect(alert).toHaveTextContent('Open it once in your notes app, or download it in Finder');
    // The file is one Lookout shows: its name, and the way to open it elsewhere, stay.
    expect(within(main()).getByRole('heading', { name: 'tide notes.md' })).toBeVisible();
    expect(main().querySelector('[data-action="open"]')).not.toBeNull();
  });

  it('DOC-2.4: Back and Esc leave the view; Esc stands down with a modifier, in a text field, from the right sidebar and while a dialog is open', async () => {
    const { props, rerender } = view();
    await screen.findByRole('region', { name: 'tide notes.md' });
    fireEvent.click(within(main()).getByRole('button', { name: 'Back' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(props.onBack).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.body, { key: 'Escape', shiftKey: true });
    const field = document.body.appendChild(document.createElement('input'));
    fireEvent.keyDown(field, { key: 'Escape' });
    const right = document.body.appendChild(document.createElement('div'));
    right.setAttribute('data-shell-column', 'right');
    fireEvent.keyDown(right.appendChild(document.createElement('button')), { key: 'Escape' });
    rerender(<DocumentView {...props} keyboardEnabled={false} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(props.onBack).toHaveBeenCalledTimes(2);
    field.remove();
    right.remove();
  });

  it('DOC-2.4: Back returns to where the document was opened from, a Topic view say, when this tab’s history has it', async () => {
    const app = renderApp('/topics', { document: async () => doc() });
    app.snapshot([row({ id: 'a', title: 'Tide tables' })]);
    expect(canGoBack()).toBe(false);
    act(() => navigateTo({ name: 'doc', path: NOTES }));
    expect(canGoBack()).toBe(true);
    await waitFor(() => expect(within(main()).getByRole('heading', { name: 'tide notes.md' })).toBeVisible());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(window.location.pathname).toBe('/topics'));
    // A replace keeps the entry's place in the history.
    act(() => navigateTo({ name: 'doc', path: NOTES }));
    act(() => navigateTo({ name: 'settings' }, { replace: true }));
    expect(canGoBack()).toBe(true);
  });

  it('DOC-2.4: Esc on a document opened from a Session, with nothing before it in this tab, returns to that Session', async () => {
    const app = renderApp(routePath({ name: 'doc', path: NOTES, session: 'a' }), { document: async () => doc() });
    app.snapshot([row({ id: 'a', title: 'Tide tables' })]);
    await waitFor(() => expect(within(main()).getByRole('heading', { name: 'tide notes.md' })).toBeVisible());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(window.location.pathname).toBe('/s/a');
  });

  it('DOC-2.5: Open leaves Lookout with the file: a Markdown file in VS Code, a page or an image in a new browser tab from the file route; O runs it', async () => {
    const browser = vi.spyOn(window, 'open').mockImplementation(() => null);
    const md = view();
    const open = await within(main()).findByRole('button', { name: 'Open in VS Code' });
    expect(open).toHaveAttribute('title', 'Open in VS Code (O)');
    fireEvent.click(open);
    expect(browser).toHaveBeenLastCalledWith('vscode://file/Users/me/harbor/output/tide%20notes.md', '_self');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(browser).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.body, { key: 'o', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'o', repeat: true });
    expect(browser).toHaveBeenCalledTimes(2);
    md.unmount();

    view({ path: '/Users/me/harbor/output/map.html', load: vi.fn(async () => doc({ path: '/Users/me/harbor/output/map.html', type: 'html' })) });
    fireEvent.click(await within(main()).findByRole('button', { name: 'Open' }));
    expect(browser).toHaveBeenLastCalledWith('/api/library/file?path=%2FUsers%2Fme%2Fharbor%2Foutput%2Fmap.html', '_blank', 'noopener,noreferrer');
  });
});

describe('what the Document view asks of the server (DOC-3.3)', () => {
  it('DOC-3.3: a view at a Session’s path asks the path check before it asks for the file; one at /doc asks for the file alone', async () => {
    const order: string[] = [];
    const checkPaths = vi.fn(async (_id: string, paths: string[]) => {
      order.push('check');
      return paths.map((path) => ({ path, exists: true, absolute: path }));
    });
    const document = vi.fn(async () => {
      order.push('document');
      return doc();
    });
    const app = renderApp(routePath({ name: 'doc', path: NOTES, session: 'a' }), { checkPaths, document });
    app.snapshot([row({ id: 'a' })]);
    await waitFor(() => expect(document).toHaveBeenCalledWith(NOTES));
    expect(checkPaths).toHaveBeenCalledWith('a', [NOTES]);
    expect(order).toEqual(['check', 'document']);

    // A check that fails (the Session ended) still asks for the file, which the server answers for itself.
    cleanup();
    order.length = 0;
    const gone = renderApp(routePath({ name: 'doc', path: NOTES, session: 'gone' }), { checkPaths: vi.fn(async () => { order.push('check'); throw new SaveError("This Session isn't running.", null, 404); }), document });
    gone.snapshot([]);
    await waitFor(() => expect(order).toEqual(['check', 'document']));

    cleanup();
    order.length = 0;
    const alone = renderApp(routePath({ name: 'doc', path: NOTES }), { checkPaths, document });
    alone.snapshot([]);
    await waitFor(() => expect(order).toEqual(['document']));
  });
});
