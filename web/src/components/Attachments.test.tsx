import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveError } from '@/lib/client';
import { renderApp, row } from '@/test/helpers';

const message = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const file = (name = 'shot.png') => new File(['bytes'], name, { type: 'image/png' });
function data(files: File[] = [], uri = '', text = '', directory = false) {
  return { files, items: files.map(f => ({ kind: 'file', getAsFile: () => f, webkitGetAsEntry: () => ({ isDirectory: directory }) })),
    types: files.length ? ['Files'] : uri ? ['text/uri-list'] : ['text/plain'],
    dropEffect: 'none', getData: (type: string) => type === 'text/uri-list' ? uri : type === 'text/plain' ? text : '' };
}
const setup = (options: Parameters<typeof renderApp>[1] = {}) => { const app = renderApp('/s/a', options); app.snapshot([row({ id: 'a' }), row({ id: 'b' })]); return app; };
beforeEach(() => localStorage.clear());

describe('composer attachments', () => {
  it('VIEW-9.1: nested drag enters keep the drop hint until the drag leaves, is dropped or cancelled', () => {
    setup(); const body = document.querySelector('main [data-shell-row="body"]')!;
    const dt = data([file()]);
    fireEvent.dragEnter(body, { dataTransfer: dt }); fireEvent.dragEnter(message(), { dataTransfer: dt });
    expect(screen.getByText('Drop to attach')).toBeInTheDocument();
    fireEvent.dragLeave(message(), { dataTransfer: dt, relatedTarget: body });
    expect(screen.getByText('Drop to attach')).toBeInTheDocument();
    fireEvent.dragLeave(body, { dataTransfer: dt, relatedTarget: document.body });
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.dragEnter(body, { dataTransfer: dt }); fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.dragEnter(body, { dataTransfer: dt }); fireEvent.dragEnd(window);
    expect(screen.queryByText('Drop to attach')).toBeNull();
  });
  it('VIEW-9.1: drops on the chat, Terminal preview and composer attach; plain text or web links stay text only in the box', async () => {
    const app = setup();
    for (const target of [document.querySelector('main [data-shell-row="body"]')!, screen.getByRole('button', { name: /Terminal/ }), message()]) {
      fireEvent.drop(target, { dataTransfer: data([file()]) });
      await waitFor(() => expect(app.client.attach).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(message().value).toContain('/attachments/shot.png'));
      vi.mocked(app.client.attach).mockClear(); fireEvent.change(message(), { target: { value: '' } });
    }
    for (const dt of [data([], '', 'selected text'), data([], 'https://example.com', 'https://example.com')]) {
      fireEvent.drop(message(), { dataTransfer: dt });
      if (dt.types.includes('text/uri-list')) expect(message().value).toContain(dt.getData('text/plain')); // Plain text retains the browser's native drop edit.
      else expect(message()).toHaveValue('');
    }
    expect(app.client.attach).not.toHaveBeenCalled();
  });
  it('VIEW-9.4: a VS Code path goes in decoded without uploading the accompanying file', () => {
    const app = setup();
    fireEvent.drop(message(), { dataTransfer: data([file()], 'file:///tmp/My%20Notes.pdf\nfile://localhost/tmp/folder/') });
    expect(message()).toHaveValue('/tmp/My\\ Notes.pdf /tmp/folder/ ');
    expect(app.client.attach).not.toHaveBeenCalled();
  });
  it('VIEW-9.4: rejected file URIs are omitted even when the drag also carries files and text', () => {
    const app = setup();
    fireEvent.drop(message(), { dataTransfer: data([file()], 'file://foreign/tmp/a', 'file://foreign/tmp/a') });
    expect(message()).toHaveValue('');
    expect(app.client.attach).not.toHaveBeenCalled();
  });
  it('VIEW-9.5: replaces the focused selection, then focuses the caret after the paths; an unfocused box appends', () => {
    setup(); const box = message();
    fireEvent.change(box, { target: { value: 'look here please' } }); box.focus(); box.setSelectionRange(5, 9);
    fireEvent.drop(box, { dataTransfer: data([], 'file:///tmp/a') });
    expect(box).toHaveValue('look /tmp/a  please');
    expect(box).toHaveFocus(); expect(box.selectionStart).toBe(12);
    box.blur(); fireEvent.drop(document.querySelector('main [data-shell-row="body"]')!, { dataTransfer: data([], 'file:///tmp/b') });
    expect(box).toHaveValue('look /tmp/a  please /tmp/b ');
  });
  it('VIEW-9.8: uploads at most four at once and inserts all successful paths together in drop order', async () => {
    const pending = new Map<string, { resolve: (p: string) => void; reject: (e: Error) => void }>();
    setup({ attach: (_file, name) => new Promise((resolve, reject) => pending.set(name, { resolve, reject })) });
    fireEvent.drop(message(), { dataTransfer: data(Array.from({ length: 6 }, (_, i) => file(`${i}.png`))) });
    expect(pending.size).toBe(4);
    await act(async () => pending.get('2.png')!.resolve('/tmp/2.png'));
    expect(pending.size).toBe(5); expect(message()).toHaveValue('');
    await act(async () => pending.get('0.png')!.reject(new SaveError('disk full', null, 507)));
    expect(pending.size).toBe(6);
    await act(async () => { for (const name of ['5.png', '4.png', '3.png', '1.png']) pending.get(name)!.resolve(`/tmp/${name}`); });
    expect(message()).toHaveValue('/tmp/1.png /tmp/2.png /tmp/3.png /tmp/4.png /tmp/5.png ');
    expect(screen.getByRole('alert')).toHaveTextContent('0.png');
  });
  it('VIEW-9.8: twenty pasted files are accepted together and their paths are present before Enter can send', async () => {
    const app = setup();
    const inputs = Array.from({ length: 20 }, (_, i) => file(`${i}.png`));
    fireEvent.paste(message(), { clipboardData: data(inputs) });
    const text = inputs.map(f => `/attachments/${f.name}`).join(' ') + ' ';
    await waitFor(() => expect(message()).toHaveValue(text));
    expect(app.client.attach).toHaveBeenCalledTimes(20);
    fireEvent.keyDown(message(), { key: 'Enter' });
    await waitFor(() => expect(app.client.sendMessage).toHaveBeenCalledWith('a', text));
  });
  it('VIEW-9.9: blocks Send and Enter during uploads while allowing typing; switching appends to the original draft', async () => {
    let finish!: (path: string) => void;
    const app = setup({ attach: () => new Promise(r => { finish = r; }) });
    fireEvent.change(message(), { target: { value: 'look' } });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    expect(screen.getByText('Attaching shot.png…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(message(), { key: 'Enter' }); expect(app.client.sendMessage).not.toHaveBeenCalled();
    fireEvent.change(message(), { target: { value: 'look more' } });
    await userEvent.click(screen.getByText('b', { selector: '[data-field="title"]' }));
    await act(async () => finish('/tmp/shot.png'));
    expect(message()).toHaveValue('');
    await userEvent.click(screen.getByText('a', { selector: '[data-field="title"]' }));
    expect(message()).toHaveValue('look more /tmp/shot.png ');
  });
  it('VIEW-9.9: an ended Session receives no paths even if its view unmounted during upload', async () => {
    let finish!: (path: string) => void;
    const app = setup({ attach: () => new Promise(r => { finish = r; }) });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    await act(async () => finish('/tmp/shot.png'));
    app.emit({ type: 'sessions', upsert: [row({ id: 'a' })], remove: [] });
    expect(message()).toHaveValue('');
  });
  it('VIEW-9.9: switching back before completion keeps Send blocked and appends to the draft despite its new selection', async () => {
    let finish!: (path: string) => void;
    setup({ attach: () => new Promise(r => { finish = r; }) });
    fireEvent.change(message(), { target: { value: 'keep this draft' } });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    await userEvent.click(screen.getByText('b', { selector: '[data-field="title"]' }));
    await userEvent.click(screen.getByText('a', { selector: '[data-field="title"]' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    message().focus(); message().setSelectionRange(0, 4);
    await act(async () => finish('/tmp/shot.png'));
    expect(message()).toHaveValue('keep this draft /tmp/shot.png ');
  });
  it('VIEW-9.9: a Codex Session getting its session id mid-upload keeps Send blocked and receives the paths', async () => {
    let finish!: (path: string) => void;
    const app = renderApp('/s/codex%3A42', { attach: () => new Promise(r => { finish = r; }) });
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    fireEvent.change(message(), { target: { value: 'look' } });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    // Its first prompt came from the terminal: the temporary id becomes the session id.
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex' })], remove: ['codex:42'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-1'));
    expect(message()).toHaveValue('look');
    expect(screen.getByText('Attaching shot.png…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(message(), { key: 'Enter' }); expect(app.client.sendMessage).not.toHaveBeenCalled();
    await act(async () => finish('/tmp/shot.png'));
    expect(message()).toHaveValue('look /tmp/shot.png ');
    expect(screen.queryByText('Attaching shot.png…')).toBeNull();
    fireEvent.keyDown(message(), { key: 'Enter' });
    await waitFor(() => expect(app.client.sendMessage).toHaveBeenCalledWith('uuid-1', 'look /tmp/shot.png '));
  });
  it('VIEW-9.9: a Codex Session viewed elsewhere while it gets its session id gets the paths at the end of its draft', async () => {
    let finish!: (path: string) => void;
    const app = renderApp('/s/codex%3A42', { attach: () => new Promise(r => { finish = r; }) });
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' }), row({ id: 'b' })]);
    fireEvent.change(message(), { target: { value: 'look' } });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    await userEvent.click(screen.getByText('b', { selector: '[data-field="title"]' }));
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex', title: 'codex' })], remove: ['codex:42'] });
    // Back before the upload finishes: still attaching under its new id.
    await userEvent.click(screen.getByText('codex', { selector: '[data-field="title"]' }));
    expect(window.location.pathname).toBe('/s/uuid-1');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.click(screen.getByText('b', { selector: '[data-field="title"]' }));
    await act(async () => finish('/tmp/shot.png'));
    await userEvent.click(screen.getByText('codex', { selector: '[data-field="title"]' }));
    expect(message()).toHaveValue('look /tmp/shot.png ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
  it('VIEW-9.9: a reused pid listed under an old, aliased id keeps its own upload and gets the paths', async () => {
    let finish!: (path: string) => void;
    const app = renderApp('/s/codex%3A42', { attach: () => new Promise(r => { finish = r; }) });
    app.snapshot([row({ id: 'codex:42', pid: 42, harness: 'codex' })]);
    app.emit({ type: 'sessions', upsert: [row({ id: 'uuid-1', pid: 42, harness: 'codex' })], remove: ['codex:42'] });
    await waitFor(() => expect(window.location.pathname).toBe('/s/uuid-1'));
    app.emit({ type: 'sessions', upsert: [], remove: ['uuid-1'] });
    // A later Codex process reuses pid 42 and is listed under the old id again.
    app.emit({ type: 'sessions', upsert: [row({ id: 'codex:42', pid: 42, harness: 'codex' })], remove: [] });
    await act(async () => { window.history.pushState(null, '', '/s/codex%3A42'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(window.location.pathname).toBe('/s/codex%3A42'));
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    expect(screen.getByText('Attaching shot.png…')).toBeInTheDocument();
    await act(async () => finish('/tmp/shot.png'));
    expect(message()).toHaveValue('/tmp/shot.png ');
    expect(screen.queryByText('Attaching shot.png…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
  it('VIEW-9.10: image-only paste attaches, but a clipboard carrying text is left to normal paste', async () => {
    const app = setup();
    fireEvent.paste(message(), { clipboardData: data([file('image.png')]) });
    await waitFor(() => expect(app.client.attach).toHaveBeenCalledTimes(1));
    expect(vi.mocked(app.client.attach).mock.calls[0]![1]).toMatch(/^pasted-\d{2}-\d{2}-\d{2}\.png$/);
    const clipboardData = { ...data([file()]), types: ['Files', 'text/plain'] };
    expect(fireEvent.paste(message(), { clipboardData })).toBe(true);
    expect(app.client.attach).toHaveBeenCalledTimes(1);
  });
  it('VIEW-9.13: rejects a Finder folder and an oversized file locally, leaving other types attachable', async () => {
    const app = setup();
    fireEvent.drop(message(), { dataTransfer: data([file('Designs')], '', '', true) });
    expect(screen.getByRole('alert')).toHaveTextContent('Lookout copies only files');
    const large = file('movie.mov'); Object.defineProperty(large, 'size', { value: 48 * 1024 * 1024 });
    fireEvent.drop(message(), { dataTransfer: data([large]) });
    expect(screen.getByRole('alert')).toHaveTextContent('48 MB'); expect(screen.getByRole('alert')).toHaveTextContent('25 MB');
    expect(app.client.attach).not.toHaveBeenCalled();
    fireEvent.drop(message(), { dataTransfer: data([new File(['data'], 'data.unknown')]) });
    await waitFor(() => expect(app.client.attach).toHaveBeenCalledTimes(1));
  });
  it('VIEW-9.14: errors name the file, persist through edits, clear on another paste/drop/send, and leave the draft intact', async () => {
    const app = setup({ attach: async () => { throw new SaveError('private details', null, null, { lost: true }); } });
    fireEvent.change(message(), { target: { value: 'keep me' } });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Lookout's server didn't answer, so shot.png wasn't attached."));
    expect(message()).toHaveValue('keep me'); fireEvent.change(message(), { target: { value: 'keep editing' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.drop(message(), { dataTransfer: data(Array.from({ length: 21 }, () => file())) });
    expect(screen.getByRole('alert')).toHaveTextContent('none of these 21'); expect(app.client.attach).toHaveBeenCalledTimes(1);
    fireEvent.drop(message(), { dataTransfer: data([], 'file:///tmp/a%0Ab') });
    expect(screen.getByRole('alert')).toHaveTextContent('control character');
    fireEvent.paste(message(), { clipboardData: data([], '', 'text') });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([
    [507, "The disk is full, so shot.png wasn't saved."],
    [500, "Lookout couldn't save shot.png."],
  ])('VIEW-9.14: a %s upload refusal has plain words and sending clears its inline error', async (status, words) => {
    const app = setup({ attach: async () => { throw new SaveError('/private/fs/error details', null, status); } });
    fireEvent.change(message(), { target: { value: 'keep me' } });
    fireEvent.drop(message(), { dataTransfer: data([file()]) });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(words));
    expect(screen.getByRole('alert')).not.toHaveTextContent('/private/fs');
    expect(message()).toHaveValue('keep me');
    fireEvent.keyDown(message(), { key: 'Enter' });
    await waitFor(() => expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'keep me'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('VIEW-9.16: only a live Controllable Session accepts drops; all other places prevent browser navigation', async () => {
    const app = setup();
    for (const target of [document.querySelector('aside')!, screen.getByRole('banner', { name: 'Session' })]) {
      const dt = data([file()]); expect(fireEvent.dragOver(target, { dataTransfer: dt })).toBe(false); expect(dt.dropEffect).toBe('none');
      expect(fireEvent.drop(target, { dataTransfer: dt })).toBe(false);
    }
    for (const event of [{ type: 'sessions' as const, upsert: [row({ id: 'a', controllable: false })], remove: [] }, { type: 'sessions' as const, upsert: [], remove: ['a'] }]) {
      app.emit(event); expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
      expect(fireEvent.drop(document.querySelector('main [data-shell-row="body"]')!, { dataTransfer: data([file()]) })).toBe(false);
    }
    expect(app.client.attach).not.toHaveBeenCalled();
  });
  it('VIEW-9.16: Settings, a past Session, History and an empty pane reject files and links without navigating', async () => {
    const app = setup();
    for (const path of ['/settings', '/h/claude/past', '/']) {
      await act(async () => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });
      expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
      for (const dt of [data([file()]), data([], 'https://example.com', 'https://example.com')]) {
        expect(fireEvent.dragOver(screen.getByRole('main'), { dataTransfer: dt })).toBe(false);
        expect(dt.dropEffect).toBe('none');
        expect(fireEvent.drop(screen.getByRole('main'), { dataTransfer: dt })).toBe(false);
        expect(window.location.pathname).toBe(path);
      }
    }
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    const history = screen.getByTestId('history-panel');
    expect(fireEvent.drop(history, { dataTransfer: data([file()]) })).toBe(false);
    expect(app.client.attach).not.toHaveBeenCalled();
  });
});
