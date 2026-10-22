import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '../shared/types.ts';
import { type LookoutApp, createApp } from './app.ts';
import type { RunError } from './exec.ts';
import { SettingsStore } from './settings.ts';
import { PR_REASON, TASK_REASON, WORK_COOLDOWN_MS, WorkMonitor } from './work.ts';

/** WORK's API: the `work` event, `PUT /api/work/watch` and `POST /api/work/refresh`, over a real WorkMonitor and a scripted tb-pr. */

const LIST = readFileSync(new URL('./fixtures/tb-pr/list.json', import.meta.url), 'utf8');
const TASKS = readFileSync(new URL('./fixtures/tb-prod/tasks.json', import.meta.url), 'utf8');
/** What `git config --global user.email` said at startup (WORK-2.5). */
const SUGGESTION = 'lamplighter@example.com';
const TOKEN = 'test-token';
const FAKE_TOKENS = ['ghp_FAKEfake0123456789', 'tok3n-s3cret-v4lue'];

let dir: string;
let settings: SettingsStore;
let app: LookoutApp;
let work: WorkMonitor;
let port: number;
let origin: string;
let now: number;
let calls: string[];
/** What tb-pr answers next, per subcommand. */
let answers: Record<string, string | RunError>;
const hosts = new Set<string>();
const origins = new Set<string>();

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lookout-work-'));
  calls = [];
  now = Date.parse('2026-10-19T10:00:00Z');
  answers = { list: LIST, refresh: 'refreshed 7 PR(s)\n', query: TASKS };
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  work = new WorkMonitor({
    runner: async (_file, args) => {
      if (_file.endsWith('tb-session')) return JSON.stringify({ results: [] });
      calls.push(args.join(' '));
      const a = answers[args[0]!]!;
      if (typeof a === 'string') return a;
      throw a;
    },
    tbPrBin: () => '/bin/tb-pr',
    tbProdBin: () => '/bin/tb-prod',
    tbSessionBin: () => '/bin/tb-session',
    now: () => now,
    onChange: (w) => app.broadcast({ type: 'work', work: w }),
  });
  // As server/main.ts wires it (WORK-2.8).
  settings.onChange((s) => work.setProductiveEmail(s.productiveEmail));
  const unused = async () => {
    throw new Error('unused');
  };
  app = createApp({
    guard: { allowedHosts: hosts, allowedOrigins: origins, token: TOKEN },
    monitor: { snapshot: () => ({ sessions: [], fleet: { state: 'ok' } }), watch: () => () => {} },
    settings,
    productiveEmailSuggestion: SUGGESTION,
    launcher: { list: () => [], recentStarts: () => [], harnesses: async () => [], start: unused, dismiss: () => false },
    usage: { snapshot: () => null, watch: () => () => {}, refreshJev: async () => {}, refresh: async () => {} },
    work,
    viewer: { watch: () => {}, drop: () => {}, send: async () => {}, earlier: unused },
    sessions: { end: unused, answer: unused, stop: unused, rename: unused, switchModel: unused, switchEffort: unused },
    files: { check: unused },
    history: { find: unused, detail: unused, resume: unused },
    staticDir: null,
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  port = (app.server.address() as AddressInfo).port;
  hosts.clear();
  origins.clear();
  hosts.add(`127.0.0.1:${port}`);
  origin = `http://127.0.0.1:${port}`;
  origins.add(origin);
});

afterEach(async () => {
  await work.close();
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin, 'x-lookout-token': TOKEN }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the answer's JSON, checked by each test
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { ...headers, ...(data ? { 'content-type': 'application/json' } : {}) } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

/** An open event stream: its events so far, and a way to close it. */
async function stream() {
  const events: ServerEvent[] = [];
  let res!: IncomingMessage;
  const req = request({ host: '127.0.0.1', port, path: '/api/events' }, (r) => {
    res = r;
    let buf = '';
    r.setEncoding('utf8');
    r.on('data', (c: string) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)) as ServerEvent);
      }
    });
  });
  req.on('error', () => {});
  req.end();
  await vi.waitFor(() => expect(events[0]?.type).toBe('snapshot'));
  const snap = events[0]!;
  const clientId = snap.type === 'snapshot' ? snap.clientId : '';
  return {
    events,
    clientId,
    raw: () => JSON.stringify(events),
    close: async () => {
      req.destroy();
      res.destroy();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

describe('WORK over the API', () => {
  it('WORK-8.1: the snapshot carries the latest Work; a tab saying it has Work open starts the reads, and `work` events follow only on change', async () => {
    const tab = await stream();
    const snap = tab.events[0]!;
    expect(snap.type === 'snapshot' && snap.work?.prs.state).toBe('loading');
    expect(calls).toEqual([]);

    expect((await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true })).status).toBe(200);
    await vi.waitFor(() => expect(tab.events.some((e) => e.type === 'work')).toBe(true));
    expect(calls).toEqual(['list --json']);
    const latest = tab.events.findLast((e) => e.type === 'work');
    expect(latest?.type === 'work' && latest.work.prs.mine.map((p) => p.number)).toEqual([2102, 2103, 2104, 2105, 2101]);

    // A new tab's snapshot carries what was read.
    const other = await stream();
    const otherSnap = other.events[0]!;
    expect(otherSnap.type === 'snapshot' && otherSnap.work?.prs.state).toBe('ok');
    // Opening it again is a no-op; the data is fresh, so no read.
    expect((await call('PUT', '/api/work/watch', { clientId: other.clientId, open: true })).status).toBe(200);
    expect((await call('PUT', '/api/work/watch', { clientId: other.clientId, open: true })).status).toBe(200);
    expect(calls).toEqual(['list --json']);
    await tab.close();
    await other.close();
  });

  it('WORK-8.1: `PUT /api/work/watch` names an open event stream, takes a boolean, and is a mutation (token and Origin)', async () => {
    const tab = await stream();
    expect((await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true }, { origin })).status).toBe(403);
    expect((await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true }, { 'x-lookout-token': TOKEN })).status).toBe(403);
    expect((await call('PUT', '/api/work/watch', { clientId: 'nope', open: true })).status).toBe(404);
    expect((await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: 'yes' })).status).toBe(400);
    expect(calls).toEqual([]);
    await tab.close();
  });

  it('WORK-8.1: a tab closing Work, or its stream, stops the polling once no tab has Work open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const tab = await stream();
      await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: false });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(calls).toHaveLength(1);

      now += 6 * 60_000;
      await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true });
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      void tab.close(); // the stream goes without saying Work closed
      // Let the server see the close (timers are fake; I/O isn't).
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /** An event stream whose tab has Work open, once its opening read has ended. */
  async function watching() {
    const tab = await stream();
    expect((await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true })).status).toBe(200);
    await vi.waitFor(() => expect(work.snapshot().prs.state).toBe('ok'));
    return tab;
  }

  it('WORK-8.1: Refresh is refused while no tab has Work open (409): it runs nothing and starts no cooldown', async () => {
    const tab = await stream();
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 409, body: { ok: false, error: "Work isn't open in any tab" } });
    expect(calls).toEqual([]);
    expect(work.snapshot().refresh.cooldownUntil).toBeNull();
    await tab.close();
  });

  it('WORK-8.2: Refresh is a mutation; accepted, it runs `tb-pr refresh` then `list --json`, and a second within 60 s is refused, not queued', async () => {
    expect((await call('POST', '/api/work/refresh', undefined, { origin })).status).toBe(403);
    expect(calls).toEqual([]);

    const tab = await watching();
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual(['list --json', 'refresh', 'list --json']);
    const latest = tab.events.findLast((e) => e.type === 'work');
    expect(latest?.type === 'work' && latest.work.refresh.cooldownUntil).toBe(now + WORK_COOLDOWN_MS);

    now += WORK_COOLDOWN_MS - 1;
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 429, body: { ok: false, error: 'Refresh was used less than a minute ago', until: now + 1 } });
    expect(calls).toEqual(['list --json', 'refresh', 'list --json']);
    await tab.close();
  });

  it('WORK-8.2: a failed refresh skips `list --json`, still starts the cooldown, and answers with the plain reason only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tab = await watching();
    answers.refresh = Object.assign(new Error('tb-pr exited with 1'), { code: 1, stderr: 'Error: GitHub API error (500): upstream\n', stdout: '' });
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 200, body: { ok: false, error: PR_REASON.serverError } });
    expect(calls).toEqual(['list --json', 'refresh']);
    expect(work.snapshot().refresh.cooldownUntil).toBe(now + WORK_COOLDOWN_MS);
    expect((await call('POST', '/api/work/refresh')).status).toBe(429);
    // What tb-pr said is in the server's log, not in the answer.
    expect(warn.mock.calls).toEqual([['lookout: tb-pr: GitHub API error (500): upstream']]);
    warn.mockRestore();
    await tab.close();
  });

  it('WORK-7.7: token-like output of a failing tb-pr reaches neither the Refresh answer, the event stream nor the server’s log', async () => {
    const logged = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn').mockImplementation(() => {})];
    const tab = await watching();
    answers.refresh = Object.assign(new Error('tb-pr exited with 1: token=tok3n-s3cret-v4lue'), {
      code: 1,
      stderr: 'Error: GitHub API error (502): Authorization: token ghp_FAKEfake0123456789 token=tok3n-s3cret-v4lue\nmore ghp_FAKEfake0123456789\n',
      stdout: 'ghp_FAKEfake0123456789',
    });
    const answer = await call('POST', '/api/work/refresh');
    expect(answer.status).toBe(200);
    await vi.waitFor(() => expect(tab.events.some((e) => e.type === 'work' && e.work.prs.state === 'error')).toBe(true));
    const printed = logged.flatMap((spy) => spy.mock.calls.flat().map(String));
    const seen = JSON.stringify(answer.body) + tab.raw() + printed.join('\n');
    expect(FAKE_TOKENS.filter((t) => seen.includes(t))).toEqual([]);
    // One redacted line, from console.warn only.
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/^lookout: tb-pr: GitHub API error \(502\): [^\n]*$/);
    for (const spy of logged) spy.mockRestore();
    await tab.close();
  });
});

describe('Tasks and the Productive email over the API (WORK-2)', () => {
  const tasksCalls = () => calls.filter((c) => c.startsWith('query tasks '));
  const emailIn = (c: string) => /"assignee\.email","operator":"eq","value":"([^"]*)"/.exec(c)?.[1];

  it('WORK-2.5: the settings carry the git suggestion, in GET, PUT’s answer, the snapshot and the `settings` event; it is never stored, and a client can’t write it', async () => {
    expect((await call('GET', '/api/settings')).body).toMatchObject({ productiveEmail: null, productiveEmailSuggestion: SUGGESTION });
    const tab = await stream();
    const snap = tab.events[0]!;
    expect(snap.type === 'snapshot' && snap.settings.productiveEmailSuggestion).toBe(SUGGESTION);
    const saved = await call('PUT', '/api/settings', { idleThresholdHours: 2 });
    expect(saved.body).toMatchObject({ idleThresholdHours: 2, productiveEmail: null, productiveEmailSuggestion: SUGGESTION });
    await vi.waitFor(() => expect(tab.events.some((e) => e.type === 'settings')).toBe(true));
    const event = tab.events.find((e) => e.type === 'settings');
    expect(event?.type === 'settings' && event.settings.productiveEmailSuggestion).toBe(SUGGESTION);
    // Saved only when you save it: the file never has it.
    const stored = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('productiveEmailSuggestion');
    expect(stored).not.toHaveProperty('productiveEmail');
    expect(await call('PUT', '/api/settings', { productiveEmailSuggestion: 'x@example.com' })).toMatchObject({ status: 400 });
    await tab.close();
  });

  it('WORK-2.7: an invalid Productive email is refused with "Enter an email such as name@example.com", and the saved value stays; empty clears it', async () => {
    expect((await call('PUT', '/api/settings', { productiveEmail: '  lamplighter@example.com ' })).body.productiveEmail).toBe('lamplighter@example.com');
    for (const bad of ['lamp lighter@example.com', 'lamplighter', 'a@b@c', 'x,colleague@example.com']) {
      expect(await call('PUT', '/api/settings', { productiveEmail: bad })).toEqual({ status: 400, body: { error: 'Enter an email such as name@example.com', field: 'productiveEmail' } });
    }
    expect(settings.get().productiveEmail).toBe('lamplighter@example.com');
    expect((await call('PUT', '/api/settings', { productiveEmail: '' })).body.productiveEmail).toBeNull();
    expect(work.snapshot().tasks.state).toBe('no-email');
  });

  it('WORK-2.6: without a saved email, the snapshot says `no-email` and no tb-prod runs; PRs are read as usual', async () => {
    const tab = await stream();
    const snap = tab.events[0]!;
    expect(snap.type === 'snapshot' && snap.work?.tasks.state).toBe('no-email');
    await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true });
    await vi.waitFor(() => expect(work.snapshot().prs.state).toBe('ok'));
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 200, body: { ok: true } });
    expect(tasksCalls()).toEqual([]);
    expect(calls).toEqual(['list --json', 'refresh', 'list --json']);
    await tab.close();
  });

  it('WORK-2.8: saving an email while a tab has Work open reads its Tasks at once, and the `work` event carries them; with Work closed, the read waits until Work opens', async () => {
    await call('PUT', '/api/settings', { productiveEmail: 'keeper@example.com' });
    expect(tasksCalls()).toEqual([]);
    const tab = await stream();
    await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true });
    await vi.waitFor(() => expect(work.snapshot().tasks.state).toBe('ok'));
    expect(tasksCalls().map(emailIn)).toEqual(['keeper@example.com']);

    // Once the first read's events are in, every event after this one follows the save.
    await vi.waitFor(() => expect(tab.events.findLast((e) => e.type === 'work')).toMatchObject({ work: { tasks: { state: 'ok' }, prs: { state: 'ok' } } }));
    const before = tab.events.length;
    await call('PUT', '/api/settings', { productiveEmail: 'lamplighter@example.com' });
    await vi.waitFor(() => expect(tasksCalls()).toHaveLength(2));
    expect(emailIn(tasksCalls()[1]!)).toBe('lamplighter@example.com');
    // What the tab heard: the list dropped ("Loading", no Tasks) before the new email itself, so it never
    // shows the new address over the old list; then the new email's Tasks.
    const after = () => tab.events.slice(before).map((e) => (e.type === 'work' ? `work:${e.work.tasks.state}` : e.type));
    await vi.waitFor(() => expect(after()).toEqual(['work:loading', 'settings', 'work:ok']));
    const works = tab.events.slice(before).flatMap((e) => (e.type === 'work' ? [e.work.tasks] : []));
    expect(works[0]!.tasks).toEqual([]);
    expect(works[1]!.tasks.map((t) => t.url)[0]).toBe('https://app.fantastic.productive.io/109-productive/tasks/41000001');
    await tab.close();
  });

  it('WORK-8.2: Refresh reads Tasks too, and answers with the plain reason of a Tasks read that failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await call('PUT', '/api/settings', { productiveEmail: 'lamplighter@example.com' });
    const tab = await stream();
    await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true });
    await vi.waitFor(() => expect(work.snapshot().tasks.state).toBe('ok'));
    const denied = JSON.stringify({ code: 'api_error', details: { body: 'nope', status: 403 }, error: 'API error (403)' });
    answers.query = Object.assign(new Error('tb-prod exited with 1'), { code: 1, stderr: '', stdout: denied });
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 200, body: { ok: false, error: TASK_REASON.denied } });
    expect(tasksCalls()).toHaveLength(2);
    expect(warn.mock.calls).toEqual([['lookout: tb-prod: api_error: API error (403)']]);
    warn.mockRestore();
    await tab.close();
  });

  it('WORK-8.4: with an email saved and GitHub rate limited, Refresh answers 429 and runs no tb-prod either', async () => {
    await call('PUT', '/api/settings', { productiveEmail: 'lamplighter@example.com' });
    answers.list = Object.assign(new Error('tb-pr exited with 1'), {
      code: 1,
      stdout: '',
      stderr: readFileSync(new URL('./fixtures/tb-pr/stderr-rate-limited-reset.txt', import.meta.url), 'utf8'), // resets at 10:42:17 UTC
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tab = await stream();
    await call('PUT', '/api/work/watch', { clientId: tab.clientId, open: true });
    await vi.waitFor(() => expect(work.snapshot()).toMatchObject({ prs: { reason: PR_REASON.rateLimited }, tasks: { state: 'ok' } }));
    const until = Date.parse('2026-10-19T10:42:17Z');
    expect(work.snapshot().refresh.githubBlockedUntil).toBe(until);
    const before = [...calls];
    expect(await call('POST', '/api/work/refresh')).toEqual({ status: 429, body: { ok: false, error: 'GitHub is rate limited', until } });
    // Refused for both sources: neither tool ran, and no cooldown started.
    expect(calls).toEqual(before);
    expect(tasksCalls()).toHaveLength(1);
    expect(work.snapshot().refresh.cooldownUntil).toBeNull();
    warn.mockRestore();
    await tab.close();
  });
});
