import { describe, expect, it } from 'vitest';
import { escapePath, fromDrop, fromPaste, insertion } from './attachments';

function transfer(files: File[] = [], uri = '', types = ['Files']): DataTransfer {
  return { files, items: files.map(file => ({ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) })), types, getData: (type: string) => type === 'text/uri-list' ? uri : '' } as unknown as DataTransfer;
}
describe('attachment input', () => {
  it('VIEW-9.4: local decoded file URIs win over copies, with folders allowed and foreign or relative URIs omitted', () => {
    const result = fromDrop(transfer([new File(['x'], 'x')], '# comment\r\nfile:///Users/me/My%20Notes.pdf\r\nfile://localhost/tmp/folder/\nfile://foreign/tmp/x\nhttps://example.com\nfile:relative\nfile:///bad%ZZ', ['Files', 'text/uri-list']));
    expect(result).toEqual([{ kind: 'path', path: '/Users/me/My Notes.pdf' }, { kind: 'path', path: '/tmp/folder/' }]);
  });
  it('VIEW-9.6: paths escape every special character but refuse control characters', () => {
    expect(escapePath('/a/ABC09._-+@,:=~日本語')).toBe('/a/ABC09._-+@,:=~日本語');
    expect(escapePath('/a/My Notes (2)\'$&[x]\\.pdf')).toBe('/a/My\\ Notes\\ \\(2\\)\\\'\\$\\&\\[x\\]\\\\.pdf');
    for (const path of ['/a\nb', '/a\rb', '/a\tb', '/a\0b', '/a\u007fb', '/a\u0085b', '/a\u2028b', '/a\u2029b']) expect(() => escapePath(path)).toThrow(/control character/);
  });
  it('VIEW-9.5: inserts at the caret or selection with separating spaces and a caret after the final space', () => {
    expect(insertion('Hello there', 6, 11, ['/tmp/a', '/tmp/My Notes'])).toEqual({ text: 'Hello /tmp/a /tmp/My\\ Notes ', caret: 28 });
    expect(insertion('abc', 3, 3, ['/tmp/a'])).toEqual({ text: 'abc /tmp/a ', caret: 11 });
    expect(insertion('', 0, 0, ['/tmp/a'])).toEqual({ text: '/tmp/a ', caret: 7 });
  });
  it('VIEW-9.10: image-only clipboard input gets a local clock name, while text wins over files', () => {
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    const at = new Date(2026, 9, 27, 10, 12, 3);
    expect(fromPaste(transfer([file]), at)).toEqual([{ kind: 'file', file, name: 'pasted-10-12-03.png', directory: false }]);
    expect(fromPaste(transfer([file], '', ['Files', 'text/plain']), at)).toEqual([]);
    const named = new File(['x'], 'diagram.png', { type: 'image/png' });
    expect(fromPaste(transfer([named]), at)[0]).toMatchObject({ name: 'diagram.png' });
  });
});
