import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathsError, checkPaths, checkSessionPaths, isPlainPath, parsePathsRequest } from './files.ts';

let dir: string;
let repo: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-files-'));
  repo = join(dir, 'acme-app');
  mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
  writeFileSync(join(repo, 'src', 'lib', 'rates.ts'), 'export {};\n');
  writeFileSync(join(repo, 'README.md'), '# Acme\n');
  writeFileSync(join(dir, 'notes.md'), '');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the path check (VIEW-1.18)', () => {
  it('VIEW-1.18: relative paths resolve against the cwd, `..` and `.` included; absolute ones are used as they are', async () => {
    const answers = await checkPaths(repo, ['src/lib/rates.ts', './README.md', 'src/lib/../../README.md', '../notes.md', join(repo, 'src', '.', 'lib', 'rates.ts'), 'src/lib/nope.ts']);
    expect(answers).toEqual([
      { path: 'src/lib/rates.ts', exists: true, absolute: join(repo, 'src/lib/rates.ts') },
      { path: './README.md', exists: true, absolute: join(repo, 'README.md') },
      { path: 'src/lib/../../README.md', exists: true, absolute: join(repo, 'README.md') },
      { path: '../notes.md', exists: true, absolute: join(dir, 'notes.md') },
      { path: join(repo, 'src', '.', 'lib', 'rates.ts'), exists: true, absolute: join(repo, 'src/lib/rates.ts') },
      { path: 'src/lib/nope.ts', exists: false, absolute: null },
    ]);
  });

  it('VIEW-1.18: only a file counts: a folder doesn’t, a symlink to a file does, a dangling one doesn’t', async () => {
    symlinkSync(join(repo, 'README.md'), join(repo, 'LINK.md'));
    symlinkSync(join(repo, 'gone.md'), join(repo, 'DANGLING.md'));
    const answers = await checkPaths(repo, ['src', 'src/lib', 'LINK.md', 'DANGLING.md']);
    expect(answers.map((a) => a.exists)).toEqual([false, false, true, false]);
  });

  it('VIEW-1.18: a path that isn’t plain is answered "not a file" without being looked up', async () => {
    const looked: string[] = [];
    const spy = async (p: string) => {
      looked.push(p);
      return stat(p);
    };
    const odd = [
      '~/README.md',
      'src/~x.ts',
      'https://example.com/README.md',
      'file:///etc/hosts',
      'C:/README.md',
      'README.md\u0000.txt',
      'src/\nREADME.md',
      'READ\u202EME.md', // a bidi control
      'READ\u200BME.md', // an invisible one
      '',
      `${'a/'.repeat(600)}README.md`,
    ];
    const answers = await checkPaths(repo, [...odd, 'README.md'], { stat: spy });
    expect(answers.slice(0, -1).every((a) => !a.exists && a.absolute === null)).toBe(true);
    expect(answers.at(-1)).toMatchObject({ exists: true });
    expect(looked).toEqual([join(repo, 'README.md')]);
    for (const p of odd) expect(isPlainPath(p), JSON.stringify(p)).toBe(false);
  });

  it('VIEW-1.18: it only stats: no file is opened or read, and nothing but whether it is a file comes back', async () => {
    const isFile = vi.fn(() => true);
    const spy = vi.fn(async () => ({ isFile }));
    const answers = await checkPaths(repo, ['src/lib/rates.ts'], { stat: spy });
    expect(spy).toHaveBeenCalledWith(join(repo, 'src/lib/rates.ts'));
    expect(Object.keys(answers[0]!).sort()).toEqual(['absolute', 'exists', 'path']);
  });

  it('VIEW-1.18: without a cwd only absolute paths are looked up; a stat that hangs counts as "not a file" after the batch’s time', async () => {
    expect(await checkPaths(null, ['README.md', join(repo, 'README.md')])).toEqual([
      { path: 'README.md', exists: false, absolute: null },
      { path: join(repo, 'README.md'), exists: true, absolute: join(repo, 'README.md') },
    ]);
    expect((await checkPaths('relative/cwd', ['README.md']))[0]!.exists).toBe(false);
    const hang = () => new Promise<{ isFile(): boolean }>(() => {});
    const started = Date.now();
    expect(await checkPaths(repo, ['README.md', 'src/lib/rates.ts'], { stat: hang, timeoutMs: 50 })).toEqual([
      { path: 'README.md', exists: false, absolute: null },
      { path: 'src/lib/rates.ts', exists: false, absolute: null },
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('VIEW-1.18: a batch is 1 to 100 strings; a Session Fleet no longer lists gets a 404', async () => {
    expect(parsePathsRequest({ paths: ['a.ts'] })).toEqual(['a.ts']);
    for (const body of [undefined, null, 'a.ts', ['a.ts'], {}, { paths: [] }, { paths: [null] }, { paths: Array(101).fill('a.ts') }]) {
      expect(() => parsePathsRequest(body), JSON.stringify(body)).toThrow(PathsError);
    }
    const lookup = (id: string) => (id === 'live' ? { cwd: repo } : null);
    expect(await checkSessionPaths({ lookup }, 'live', { paths: ['README.md'] })).toEqual([{ path: 'README.md', exists: true, absolute: join(repo, 'README.md') }]);
    await expect(checkSessionPaths({ lookup }, 'ended', { paths: ['README.md'] })).rejects.toMatchObject({ status: 404 });
  });
});
