import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './exec.ts';
import { cleanFleetError, fetchMessages, messagesArgs, toEntry } from './messages.ts';

const FAKE = new URL('./fixtures/fleet/messages/fake-fleet.mjs', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/fleet/messages/', import.meta.url).pathname;
const CLAUDE = 'aaaaaaaa-0000-4000-8000-000000000101';
const CODEX = 'bbbbbbbb-0000-4000-8000-000000000102';

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-messages-'));
  cpSync(FIXTURES, dir, { recursive: true });
  env = { PATH: process.env.PATH, FAKE_FLEET_DIR: dir };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fetchReal = (target: string, q: Parameters<typeof fetchMessages>[3]) =>
  fetchMessages(run, FAKE, target, q, { timeoutMs: 5000, env });

describe('fleet messages (through a fake `fleet` that follows the contract)', () => {
  it('passes cursors as `--opt=value` and the target after `--`', () => {
    expect(messagesArgs('sess', { limit: 100 })).toEqual(['--local', 'messages', '--json', '--limit', '100', '--', 'sess']);
    expect(messagesArgs('77', { after: '-c1.3', limit: 500 })).toEqual(['--local', 'messages', '--json', '--after=-c1.3', '--limit', '500', '--', '77']);
    expect(messagesArgs('77', { before: 'c1.3', limit: 100 })).toContain('--before=c1.3');
  });

  it('VIEW-1.1: reads a Claude Code Transcript in order: prompts, Markdown replies, tool calls, questions', async () => {
    const res = await fetchReal(CLAUDE, { limit: 30 });
    if (!res.ok) throw new Error(res.error);
    expect(res.harness).toBe('claude');
    const kinds = res.entries.map((e) => e.kind);
    expect(kinds).toContain('user');
    expect(kinds).toContain('assistant');
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('question');
    const fixRequest = res.entries.find((e) => e.kind === 'user' && e.text.startsWith('Fix the rate rounding'));
    const reply = res.entries.find((e) => e.kind === 'assistant' && e.text.includes('```ruby'));
    expect(res.entries.indexOf(fixRequest!)).toBeLessThan(res.entries.indexOf(reply!));
    expect(res.entries.at(-1)).toMatchObject({ kind: 'question', status: 'pending', answer: null });
    expect(res.cursor!.startsWith(res.entries.at(-1)!.cursor)).toBe(true); // plus Fleet's read hint
  });

  it('VIEW-1.1: reads a Codex Transcript, its tool calls included', async () => {
    const res = await fetchReal(CODEX, { limit: 100 });
    if (!res.ok) throw new Error(res.error);
    expect(res.harness).toBe('codex');
    expect(res.entries.filter((e) => e.kind === 'tool_call').map((e) => e.kind === 'tool_call' && e.tool)).toContain('exec_command');
    expect(res.hasMoreBefore).toBe(false);
  });

  it('VIEW-1.3: subagent results (`system`) are kept, bounded like other text; kinds Lookout does not know are left out', async () => {
    const res = await fetchReal(CLAUDE, { limit: 500 });
    if (!res.ok) throw new Error(res.error);
    expect(res.entries.filter((e) => e.kind === 'system').map((e) => e.text)).toEqual([
      'Agent "Survey rate code" finished',
      'Background command "rspec spec/services/deals" completed',
    ]);
    expect(res.entries.some((e) => e.kind === 'user' && e.text.includes('hook'))).toBe(false);
    for (const kind of ['thinking', 'hook', 'tool_result', 'sidechain', 'bookkeeping']) {
      expect(toEntry({ cursor: 'c', kind, role: 'assistant', text: 'secret thoughts', ts: null })).toBeNull();
    }
    const ts = '2026-10-16T10:04:00Z';
    expect(toEntry({ cursor: 'c9', kind: 'system', role: 'user', text: 'Agent "Build" finished', ts })).toEqual({ kind: 'system', cursor: 'c9', ts, text: 'Agent "Build" finished' });
    const long = toEntry({ cursor: 'c9', kind: 'system', role: 'user', text: 'x'.repeat(300_000), ts });
    expect(long?.kind === 'system' && long.text.length).toBe(200_000);
    expect(toEntry({ cursor: 'c9', kind: 'system', role: 'user', text: '  \n ', ts })).toBeNull();
    expect(toEntry({ cursor: 'c9', kind: 'system', role: 'user', text: 42, ts })).toBeNull();
  });

  it('VIEW-1.6: the latest entries first, then pages back with --before', async () => {
    const tail = await fetchReal(CLAUDE, { limit: 100 });
    if (!tail.ok) throw new Error(tail.error);
    expect(tail.hasMoreBefore).toBe(true);
    expect(tail.oldest).toBe('c1.43'); // 143 entries in all
    const page = await fetchReal(CLAUDE, { before: tail.oldest!, limit: 100 });
    if (!page.ok) throw new Error(page.error);
    expect(page.oldest).toBe('c1.0');
    expect(page.hasMoreBefore).toBe(false);
    expect(page.entries.at(-1)!.cursor).toBe('c1.42');
  });

  it('VIEW-1.4: --after returns only newer entries', async () => {
    const tail = await fetchReal(CODEX, { limit: 100 });
    if (!tail.ok) throw new Error(tail.error);
    const none = await fetchReal(CODEX, { after: tail.cursor!, limit: 500 });
    expect(none).toMatchObject({ ok: true, entries: [], cursor: tail.cursor });
    await run(FAKE, ['--local', 'send', '--', CODEX, 'Run the PDF specs again'], { timeoutMs: 5000, env });
    const more = await fetchReal(CODEX, { after: tail.cursor!, limit: 500 });
    if (!more.ok) throw new Error(more.error);
    expect(more.entries.map((e) => e.kind)).toEqual(['user', 'assistant']);
  });

  it('VIEW-1.4: a rewritten Transcript is `cursor_invalid`, read from the JSON Fleet prints on a failure', async () => {
    const file = join(dir, 'sessions', `${CODEX}.json`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"generation": 1', '"generation": 2'));
    expect(await fetchReal(CODEX, { after: 'c1.3', limit: 500 })).toMatchObject({ ok: false, kind: 'cursor_invalid' });
  });

  it('VIEW-1.8: a Session with no Transcript yet is an empty conversation; a Claude Session without a session id is `transcript_not_found`', async () => {
    expect(await fetchReal('dddddddd-0000-4000-8000-000000000104', { limit: 100 })).toMatchObject({ ok: true, entries: [], queue: [], cursor: null, hasMoreBefore: false });
    expect(await fetchReal('61005', { limit: 100 })).toMatchObject({ ok: false, kind: 'transcript_not_found', error: expect.stringContaining('no session id') });
    expect(await fetchReal('nope', { limit: 100 })).toMatchObject({ ok: false, kind: 'target_not_found' });
  });

  it('a Fleet without `messages`, a missing Fleet, a hang and garbage are classified, never thrown', async () => {
    const old = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 2, stderr: "error: unrecognized subcommand 'messages'\n", stdout: '' });
    });
    expect(await fetchMessages(old, 'fleet', 's', { limit: 1 }, { timeoutMs: 1 })).toMatchObject({ ok: false, kind: 'unsupported' });
    const missing = vi.fn(async () => {
      throw Object.assign(new Error('spawn fleet ENOENT'), { code: 'ENOENT' });
    });
    expect(await fetchMessages(missing, 'fleet', 's', { limit: 1 }, { timeoutMs: 1 })).toMatchObject({ kind: 'not_installed' });
    const slow = vi.fn(async () => {
      throw Object.assign(new Error('x'), { timedOut: true });
    });
    expect(await fetchMessages(slow, 'fleet', 's', { limit: 1 }, { timeoutMs: 1 })).toMatchObject({ kind: 'timeout' });
    const garbage = vi.fn(async () => 'not json');
    expect(await fetchMessages(garbage, 'fleet', 's', { limit: 1 }, { timeoutMs: 1 })).toMatchObject({ kind: 'invalid_output' });
  });
});

describe('entries are validated and bounded', () => {
  it('VIEW-1.9: an abandoned question (never answered, the conversation moved on) keeps that status', () => {
    expect(toEntry({ cursor: 'c', kind: 'question', questions: [{ question: 'Q', options: [{ label: 'x' }] }], status: 'abandoned', answer: null })).toMatchObject({
      status: 'abandoned',
      answer: null,
    });
  });

  it('a call Lookout cancelled is `cancelled`, not an error to show', async () => {
    const cancelled = vi.fn(async () => {
      throw Object.assign(new Error('fleet was cancelled'), { aborted: true, code: null });
    });
    expect(await fetchMessages(cancelled, 'fleet', 's', { limit: 1 }, { timeoutMs: 1 })).toMatchObject({ ok: false, kind: 'cancelled' });
  });

  it('drops malformed entries and fills defaults', () => {
    expect(toEntry(null)).toBeNull();
    expect(toEntry({ kind: 'user', text: 'no cursor' })).toBeNull();
    expect(toEntry({ cursor: 'c', kind: 'user', text: '   ' })).toBeNull();
    expect(toEntry({ cursor: 'c', kind: 'tool_call', summary: 'x' })).toBeNull(); // no tool
    expect(toEntry({ cursor: 'c', kind: 'user', text: 'hi', ts: 5, queued: 'yes' })).toEqual({ kind: 'user', cursor: 'c', ts: null, text: 'hi', queued: false });
  });

  it('VIEW-1.2: a tool call keeps one short line of argument, never output', () => {
    const e = toEntry({ cursor: 'c', kind: 'tool_call', id: 't', tool: 'Bash', summary: `echo one\necho two ${'x'.repeat(400)}`, output: 'SECRET OUTPUT' });
    expect(e).toMatchObject({ kind: 'tool_call', tool: 'Bash' });
    expect(e && 'summary' in e && e.summary.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(e)).not.toContain('SECRET OUTPUT');
    expect(e && 'summary' in e && e.summary).not.toContain('\n');
  });

  it('VIEW-1.9: questions keep their options and answer; anything else in them is dropped', () => {
    const q = toEntry({
      cursor: 'c',
      kind: 'question',
      id: 'toolu_1',
      questions: [{ question: 'Which?', header: 'Pick', multiSelect: true, options: [{ label: 'A', description: 'first' }, { label: '' }, 'junk', { label: 'D' }], extra: 1 }],
      status: 'answered',
      answer: { answers: ['A, D', 7], picked: [[0, 3, 3, 9, -1, 1.5, 'x'], [0]] },
    });
    expect(q).toEqual({
      kind: 'question',
      cursor: 'c',
      ts: null,
      id: 'toolu_1',
      // Every option keeps its place, so `picked` indexes still point at the right one.
      questions: [
        {
          question: 'Which?',
          header: 'Pick',
          multiSelect: true,
          options: [
            { label: 'A', description: 'first' },
            { label: '', description: '' },
            { label: '', description: '' },
            { label: 'D', description: '' },
          ],
        },
      ],
      status: 'answered',
      answer: { answers: ['A, D'], picked: [[0, 3]] }, // one per question; invalid indexes dropped
    });
    expect(toEntry({ cursor: 'c', kind: 'question', questions: [{ question: 'Q', options: [{ label: 'x' }] }], status: 'answered', answer: { answers: ['x'] } })).toMatchObject({
      answer: { answers: ['x'], picked: null }, // an older Fleet without `picked`
    });
    expect(toEntry({ cursor: 'c', kind: 'question', questions: [], status: 'pending' })).toBeNull();
    expect(toEntry({ cursor: 'c', kind: 'question', questions: [{ question: 'Q', options: [{ label: 'x' }] }], status: 'weird', answer: { declined: true } })).toMatchObject({
      status: 'pending',
      answer: { declined: true },
    });
  });
});

describe('Fleet error text', () => {
  it('goes through the shared sanitizer: dash-separated tokens (Slack, GitHub) are redacted too', () => {
    const slack = 'xoxb-1234567890123-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx';
    expect(cleanFleetError(`io: posting failed with ${slack}`)).not.toContain('AbCdEfGhIjKlMnOpQrStUvWx');
    expect(cleanFleetError('clone failed: ghp_abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('abcdefghijklmnop');
    expect(cleanFleetError('a \\u0074mux error')).toBe('The Session host could not be read.'); // escapes decoded first
  });

  it('is one bounded line with secrets redacted, and never names tmux (0001)', () => {
    expect(cleanFleetError('error: io failed reading https://user:hunter2@example.com/x\nsecond line')).toBe('io failed reading https://…@example.com/x');
    expect(cleanFleetError('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def');
    expect(cleanFleetError('token=sk-live_1234567890')).not.toContain('1234567890');
    expect(cleanFleetError(`x${'y'.repeat(500)}`)!.length).toBeLessThanOrEqual(200);
    expect(cleanFleetError('tmux capture-pane: no such pane')).toBe('The Session host could not be read.');
    // eslint-disable-next-line no-control-regex -- checking control characters are gone
    expect(cleanFleetError('bell\u0007 and \u001b[31mred')).not.toMatch(/[\u0007\u001b]/);
    expect(cleanFleetError(42)).toBeNull();
  });
});
