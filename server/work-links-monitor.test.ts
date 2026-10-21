import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunOptions } from './exec.ts';
import { WorkMonitor, parseTasksPage, parseTbPrList, tasksQueryArgv } from './work.ts';

const LIST = readFileSync(new URL('./fixtures/tb-pr/list.json', import.meta.url), 'utf8');
const TASKS = readFileSync(new URL('./fixtures/tb-prod/tasks.json', import.meta.url), 'utf8');
const TASK_URL = 'https://app.fantastic.productive.io/109-productive/tasks/41000001';

describe('Work Link searches (WORK-4.8, WORK-4.9)', () => {
  afterEach(() => vi.useRealTimers());

  it('WORK-4.3: searches find old Productive paths and Fantastic query or legacy paths', async () => {
    const prompts = [
      'https://app.productive.io/109-productive/tasks/41000001',
      'https://app.productive.io/109-productive/tasks/task/41000001',
      'https://app.fantastic.productive.io/109-productive/tasks/task/41000001',
      'https://app.fantastic.productive.io/109-productive/home?task=41000001',
    ];
    const queries: string[] = [];
    const monitor = new WorkMonitor({
      runner: async (file, argv) => {
        if (file.endsWith('tb-pr')) return LIST;
        if (file.endsWith('tb-prod')) return TASKS;
        const query = argv.at(-1)!;
        queries.push(query);
        return JSON.stringify({ results: prompts.flatMap((first_prompt, index) =>
          first_prompt.includes(query.replace('=', '/')) || first_prompt.includes(query)
            ? [{ session_id: `form-${index}`, first_prompt }] : []) });
      },
      tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com', onChange: () => {},
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links?.sessions).toHaveLength(4));
      expect(queries).toContain('tasks/41000001');
      expect(queries).toContain('task=41000001');
    } finally { close(); await monitor.close(); }
  });

  it('WORK-4.9: a Fleet-triggered Task Link appears within 10 s while an unrelated search stays slow', async () => {
    let releaseSlow!: (value: string) => void;
    let rejectSlow!: (reason: unknown) => void;
    const slow = new Promise<string>((resolve, reject) => { releaseSlow = resolve; rejectSlow = reject; });
    const taskSession = { session_id: 'new-task-session', first_prompt: `Start ${TASK_URL}` };
    const events: unknown[] = [];
    let indexed = false;
    const monitor = new WorkMonitor({
      runner: async (file, argv, opts) => {
        if (file.endsWith('tb-pr')) return LIST;
        if (file.endsWith('tb-prod')) return TASKS;
        if (argv.at(-1) === 'https://github.com/productiveio/willow/pull/2102' && !indexed) {
          opts.signal?.addEventListener('abort', () => rejectSlow(Object.assign(new Error('cancelled'), { aborted: true })), { once: true });
          return slow;
        }
        return JSON.stringify({ results: indexed && argv.at(-1) === 'tasks/41000001' ? [taskSession] : [] });
      },
      tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com', onChange: (snapshot) => events.push(snapshot),
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(monitor.snapshot().tasks.state).toBe('ok'));
      indexed = true;
      const started = Date.now();
      monitor.setLiveSessions(['new-task-session']);
      await vi.waitFor(() => expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links?.sessions)
        .toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'new-task-session', live: true })])));
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(events.length).toBeGreaterThan(0);
    } finally { releaseSlow(JSON.stringify({ results: [] })); close(); await monitor.close(); }
  });

  it('WORK-4.9: a 1.5 s search publishes its Link before a one-second retry replaces it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-21T12:00:00Z'));
    const session = { session_id: 'slow-indexed', first_prompt: `Start ${TASK_URL}` };
    let indexed = false;
    let taskCalls = 0;
    const monitor = new WorkMonitor({
      runner: async (file, argv) => {
        if (file.endsWith('tb-pr')) return LIST;
        if (file.endsWith('tb-prod')) return TASKS;
        const query = argv.at(-1);
        if (query === 'tasks/41000001') taskCalls++;
        const rows = indexed && query === 'tasks/41000001' ? [session] : [];
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        return JSON.stringify({ results: rows });
      },
      tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com', onChange: () => {},
    });
    const close = monitor.watch();
    try {
      await vi.advanceTimersByTimeAsync(2000);
      indexed = true;
      monitor.setLiveSessions(['slow-indexed']);
      const started = Date.now();
      await vi.advanceTimersByTimeAsync(3500);
      expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links?.sessions)
        .toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'slow-indexed', live: true })]));
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(taskCalls).toBeGreaterThan(1);
    } finally { close(); const ending = monitor.close(); await vi.advanceTimersByTimeAsync(20_000); await ending; }
  });

  it('WORK-4.9: an urgent search cancels a near-timeout search holding the shared index', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-21T12:00:00Z'));
    const session = { session_id: 'urgent-indexed', first_prompt: `Start ${TASK_URL}` };
    let lockHeld = false;
    let cancelled = false;
    let indexed = false;
    const monitor = new WorkMonitor({
      runner: async (file, argv, opts) => {
        if (file.endsWith('tb-pr')) return LIST;
        if (file.endsWith('tb-prod')) return TASKS;
        const query = argv.at(-1);
        if (query === 'https://github.com/productiveio/willow/pull/2102' && !indexed) {
          lockHeld = true;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { lockHeld = false; resolve(); }, 19_000);
            opts.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              lockHeld = false;
              cancelled = true;
              reject(Object.assign(new Error('cancelled'), { aborted: true }));
            }, { once: true });
          });
        }
        while (lockHeld) await new Promise<void>((resolve) => setTimeout(resolve, 100));
        return JSON.stringify({ results: indexed && query === 'tasks/41000001' ? [session] : [] });
      },
      tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com', onChange: () => {},
    });
    const close = monitor.watch();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(lockHeld).toBe(true);
      indexed = true;
      monitor.setLiveSessions(['urgent-indexed']);
      const started = Date.now();
      await vi.advanceTimersByTimeAsync(9000);
      expect(cancelled).toBe(true);
      expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links?.sessions)
        .toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'urgent-indexed', live: true })]));
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally { close(); const ending = monitor.close(); await vi.advanceTimersByTimeAsync(20_000); await ending; }
  });

  it('WORK-2.4: Fleet removal publishes a cleared live marker with the past Session still linked', async () => {
    const events: ReturnType<WorkMonitor['snapshot']>[] = [];
    const rows = [
      { session_id: 'live', first_prompt: TASK_URL, modified_at: '2026-10-20T12:00:00Z' },
      { session_id: 'past', first_prompt: TASK_URL, modified_at: '2026-10-21T12:00:00Z' },
    ];
    const monitor = new WorkMonitor({
      runner: async (file, argv) => file.endsWith('tb-pr') ? LIST : file.endsWith('tb-prod') ? TASKS
        : JSON.stringify({ results: argv.at(-1) === 'tasks/41000001' ? rows : [] }),
      tbPrBin: () => '/bin/tb-pr', tbProdBin: () => '/bin/tb-prod', tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com', onChange: (snapshot) => events.push(snapshot),
    });
    monitor.setLiveSessions(['live']);
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(monitor.snapshot().tasks.tasks[0]?.links?.sessions).toHaveLength(2));
      const before = events.length;
      monitor.setLiveSessions([]);
      expect(events).toHaveLength(before + 1);
      expect(events.at(-1)?.tasks.tasks[0]?.links?.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: 'live', live: false }),
        expect.objectContaining({ sessionId: 'past', live: false }),
      ]));
    } finally { close(); await monitor.close(); }
  });

  it('WORK-4.3, WORK-4.8, WORK-4.9: Task searches use full URLs and a new Fleet Session links without rereading either source', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-21T12:00:00Z'));
    const calls: { tool: string; argv: string[] }[] = [];
    let transcriptRows: Record<string, unknown>[] = [
      ...Array.from({ length: 200 }, (_, index) => ({ session_id: `id-only-${index}`, first_prompt: 'Please continue task 41000001' })),
      {
        session_id: 'task-url-session',
        first_prompt: `Start work at ${TASK_URL}`,
        created_at: '2026-10-21T11:59:00Z',
        modified_at: '2026-10-21T12:00:00Z',
      },
    ];
    const runner = async (file: string, argv: readonly string[], _opts: RunOptions) => {
      const tool = file.split('/').at(-1)!;
      calls.push({ tool, argv: [...argv] });
      if (tool === 'tb-pr') return LIST;
      if (tool === 'tb-prod') return TASKS;
      const query = argv.at(-1)!;
      return JSON.stringify({ results: transcriptRows.filter((row) => String(row.first_prompt).includes(query)).slice(0, 200) });
    };
    const monitor = new WorkMonitor({
      runner,
      tbPrBin: () => '/bin/tb-pr',
      tbProdBin: () => '/bin/tb-prod',
      tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com',
      onChange: () => {},
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => {
        expect(monitor.snapshot().tasks.state).toBe('ok');
        expect(monitor.snapshot().prs.state).toBe('ok');
      });
      const itemCount = Object.values(parseTbPrList(LIST).columns).flat().length + parseTasksPage(TASKS).tasks.length * 2;
      await vi.waitFor(() => expect(calls.filter((call) => call.tool === 'tb-session').length).toBe(itemCount));
      const firstSearches = calls.filter((call) => call.tool === 'tb-session');
      expect(firstSearches).toHaveLength(itemCount);
      expect(firstSearches.every(({ argv }) => argv.slice(0, 5).join(' ') === 'search --all-projects --limit 200 --json')).toBe(true);
      expect(firstSearches.map(({ argv }) => argv.at(-1))).toEqual(expect.arrayContaining(['https://github.com/productiveio/willow/pull/2102', 'tasks/41000001', 'task=41000001']));
      expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links).toMatchObject({
        sessions: [{ sessionId: 'task-url-session', reason: 'started on this Task' }],
        incomplete: false,
      });
      const sourceReads = calls.filter((call) => call.tool === 'tb-pr' || call.tool === 'tb-prod').length;

      transcriptRows = [{
        session_id: 'new-session',
        harness: 'claude',
        summary: 'Light the harbor lanterns',
        first_prompt: `Start work at ${TASK_URL}`,
        created_at: '2026-10-21T11:59:00Z',
        modified_at: '2026-10-21T12:00:00Z',
      }];
      monitor.setLiveSessions(['new-session']);
      await vi.waitFor(() => expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links?.sessions).toMatchObject([
        { sessionId: 'new-session', reason: 'started on this Task', live: true },
      ]));
      expect(calls.filter((call) => call.tool === 'tb-pr' || call.tool === 'tb-prod')).toHaveLength(sourceReads);
      expect(calls.filter((call) => call.tool === 'tb-session')).toHaveLength(itemCount * 2);
    } finally {
      close();
      await monitor.close();
    }
  });

  it('WORK-4.9: retries Link searches after Fleet gains a Session until tb-session indexes its prompt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-21T12:00:00Z'));
    const calls: { tool: string; argv: string[] }[] = [];
    let indexed = false;
    const session = {
      session_id: 'new-session',
      harness: 'claude',
      summary: 'Hang the lanterns',
      first_prompt: `Start work at ${TASK_URL}`,
      created_at: '2026-10-21T11:59:00Z',
      modified_at: '2026-10-21T12:00:00Z',
    };
    const runner = async (file: string, argv: readonly string[]) => {
      const tool = file.split('/').at(-1)!;
      calls.push({ tool, argv: [...argv] });
      if (tool === 'tb-pr') return LIST;
      if (tool === 'tb-prod') return TASKS;
      return JSON.stringify({ results: indexed && argv.at(-1) === 'tasks/41000001' ? [session] : [] });
    };
    const monitor = new WorkMonitor({
      runner,
      tbPrBin: () => '/bin/tb-pr',
      tbProdBin: () => '/bin/tb-prod',
      tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com',
      onChange: () => {},
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(monitor.snapshot().tasks.state).toBe('ok'));
      await vi.waitFor(() => expect(calls.filter((call) => call.tool === 'tb-session').length).toBeGreaterThan(0));
      indexed = false;
      monitor.setLiveSessions(['new-session']);
      setTimeout(() => { indexed = true; }, 1500);

      await vi.advanceTimersByTimeAsync(3000);
      expect(Date.now() - Date.parse('2026-10-21T12:00:00Z')).toBeLessThanOrEqual(10_000);
      expect(monitor.snapshot().tasks.tasks.find((task) => task.id === '41000001')?.links?.sessions).toMatchObject([
        { sessionId: 'new-session', reason: 'started on this Task', live: true },
      ]);
      expect(calls.filter((call) => call.tool === 'tb-session' && call.argv.at(-1) === 'tasks/41000001').length).toBeGreaterThan(2);
    } finally {
      close();
      await monitor.close();
    }
  });

  it('WORK-7.7: token-like text in tb-session titles and first-prompt fallbacks is redacted from Work', async () => {
    const secrets = ['ghp_FAKEgithubtoken123', 'github_pat_FAKEgithubpat123', 'private-access-token', 'auth-header-secret'];
    const rows = [
      {
        session_id: 'summary-secret',
        harness: 'claude',
        summary: `Review ${secrets[0]} github_pat_FAKEgithubpat123 access_token=${secrets[2]} Authorization: Bearer ${secrets[3]}`,
        first_prompt: `Start ${TASK_URL}`,
        created_at: '2026-10-21T11:59:00Z',
        modified_at: '2026-10-21T12:00:00Z',
      },
      {
        session_id: 'prompt-secret',
        harness: 'claude',
        first_prompt: `Start ${TASK_URL} with ghp_FAKEgithubtoken123`,
        created_at: '2026-10-21T11:58:00Z',
        modified_at: '2026-10-21T12:00:00Z',
      },
    ];
    const events: unknown[] = [];
    const monitor = new WorkMonitor({
      runner: async (file, argv) => {
        if (file.endsWith('tb-pr')) return LIST;
        if (file.endsWith('tb-prod')) return TASKS;
        return JSON.stringify({ results: argv.at(-1) === 'tasks/41000001' ? rows : [] });
      },
      tbPrBin: () => '/bin/tb-pr',
      tbProdBin: () => '/bin/tb-prod',
      tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com',
      onChange: (work) => events.push(work),
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(monitor.snapshot().tasks.tasks[0]?.links?.sessions).toHaveLength(2));
      const output = JSON.stringify([monitor.snapshot(), events]);
      for (const secret of secrets) expect(output).not.toContain(secret);
      expect(monitor.snapshot().tasks.tasks[0]?.links?.sessions?.every((link) => link.title.length > 0)).toBe(true);
    } finally {
      close();
      await monitor.close();
    }
  });

  it('WORK-2.8, WORK-8.3: a new email read starts when the previous read has moved on to Link searches', async () => {
    let releaseSearch!: (value: string) => void;
    const blockedSearch = new Promise<string>((resolve) => { releaseSearch = resolve; });
    const calls: { tool: string; argv: string[] }[] = [];
    const monitor = new WorkMonitor({
      runner: async (file, argv) => {
        const tool = file.split('/').at(-1)!;
        calls.push({ tool, argv: [...argv] });
        if (tool === 'tb-pr') return LIST;
        if (tool === 'tb-prod') return TASKS;
        return blockedSearch;
      },
      tbPrBin: () => '/bin/tb-pr',
      tbProdBin: () => '/bin/tb-prod',
      tbSessionBin: () => '/bin/tb-session',
      productiveEmail: 'lamplighter@example.com',
      onChange: () => {},
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(calls.some((call) => call.tool === 'tb-session')).toBe(true));
      monitor.setProductiveEmail('keeper@example.com');
      await vi.waitFor(() => expect(calls.filter((call) => call.tool === 'tb-prod')).toHaveLength(2));
      expect(calls.find((call) => call.tool === 'tb-prod' && JSON.stringify(call.argv).includes('keeper@example.com'))?.argv)
        .toEqual(tasksQueryArgv('keeper@example.com', 1));
    } finally {
      releaseSearch(JSON.stringify({ results: [] }));
      close();
      await monitor.close();
    }
  });

  it('WORK-7.7: token-like tb-session stderr reaches neither Work nor the server log', async () => {
    const token = 'ghp_FAKEfake0123456789';
    const calls: string[] = [];
    const events: unknown[] = [];
    const logged: string[] = [];
    const monitor = new WorkMonitor({
      runner: async (file, _argv, _opts) => {
        if (file.endsWith('tb-pr')) return LIST;
        calls.push(file);
        throw Object.assign(new Error('search failed'), { stderr: `Authorization: Bearer ${token}` });
      },
      tbPrBin: () => '/bin/tb-pr',
      tbProdBin: () => '/bin/tb-prod',
      tbSessionBin: () => '/bin/tb-session',
      onChange: (work) => events.push(work),
      log: (line) => logged.push(line),
    });
    const close = monitor.watch();
    try {
      await vi.waitFor(() => expect(monitor.snapshot().sessionLinks.state).toBe('error'));
      expect(calls.length).toBeGreaterThan(0);
      expect(logged).toHaveLength(1);
      expect(logged[0]).not.toContain(token);
      expect(logged[0]).not.toMatch(/[\r\n]/);
      expect(JSON.stringify([monitor.snapshot(), events])).not.toContain(token);
      expect(monitor.snapshot().sessionLinks.reason).not.toContain(token);
    } finally {
      close();
      await monitor.close();
    }
  });
});
