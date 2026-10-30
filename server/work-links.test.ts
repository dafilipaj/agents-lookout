import type { WorkPr, WorkTask } from '../shared/work.ts';
import { describe, expect, it } from 'vitest';
import { buildWorkLinks, containsTaskUrl, containsWholeUrl, parseSessionSearch, type LinkCandidate, type SessionSearchResult } from './work-links.ts';

const PR_URL = 'https://github.com/productiveio/lantern/pull/12';
const PR_CREATED = Date.parse('2026-10-21T12:00:00Z');

function pr(over: Partial<WorkPr> = {}): WorkPr {
  return {
    repo: 'lantern',
    number: 12,
    title: 'Light the harbor lanterns',
    url: PR_URL,
    author: null,
    createdAt: PR_CREATED,
    ageDays: 1,
    rotting: 'fresh',
    ci: 'passing',
    chip: 'ready',
    column: 'review_mine',
    taskIds: [],
    links: null,
    ...over,
  };
}

function task(over: Partial<WorkTask> = {}): WorkTask {
  const id = over.id ?? '41000123';
  return {
    id,
    title: 'Light the harbor lanterns',
    project: 'Lantern Works',
    status: 'In progress',
    statusCategory: 'started',
    statusColor: null,
    dueDate: null,
    lastActivityAt: PR_CREATED,
    milestone: false,
    description: null,
    url: `https://app.fantastic.productive.io/109-productive/tasks/${id}`,
    links: null,
    ...over,
  };
}

function candidate(over: Partial<LinkCandidate> & { sessionId: string }): LinkCandidate {
  return {
    harness: 'claude',
    title: `Session ${over.sessionId}`,
    firstPrompt: 'Fix the harbor lanterns',
    createdAt: PR_CREATED - 60_000,
    modifiedAt: PR_CREATED + 60_000,
    ...over,
  };
}

function search(...sessions: LinkCandidate[]): SessionSearchResult {
  return { sessions, incomplete: false };
}

describe('Links between Tasks, PRs and Sessions (WORK-4)', () => {
  it('WORK-4.1: links each matching tb-pr task id with its source and builds the reverse Task link', () => {
    const task1 = task();
    const task2 = task({ id: '41000124', title: 'Ring the harbor bells' });
    const linkedPr = pr({ taskIds: [{ id: task1.id, source: 'branch' }, { id: task1.id, source: 'body' }, { id: task2.id, source: 'body' }] });
    const result = buildWorkLinks([linkedPr], [task1, task2], { prs: new Map(), tasks: new Map() }, new Set());

    expect(result.prs[0]?.links?.tasks).toEqual([
      { id: task1.id, title: task1.title, sources: ['branch', 'body'] },
      { id: task2.id, title: task2.title, sources: ['body'] },
    ]);
    expect(result.tasks.map((t) => t.links?.prs)).toEqual([
      [{ repo: 'lantern', number: 12, url: PR_URL, chip: 'ready', ci: 'passing', sources: ['branch', 'body'] }],
      [{ repo: 'lantern', number: 12, url: PR_URL, chip: 'ready', ci: 'passing', sources: ['body'] }],
    ]);
  });

  it('WORK-4.2: infers only the earliest Session whose life spans PR creation, with five minutes of slack', () => {
    const earliest = candidate({ sessionId: 'earliest', createdAt: PR_CREATED - 60 * 60_000, modifiedAt: PR_CREATED - 5 * 60_000 });
    const later = candidate({ sessionId: 'later', createdAt: PR_CREATED + 5 * 60_000, modifiedAt: PR_CREATED + 5 * 60_000 });
    const tooOld = candidate({ sessionId: 'too-old', createdAt: PR_CREATED - 6 * 60_000, modifiedAt: PR_CREATED - 6 * 60_000 });
    const tooLate = candidate({ sessionId: 'too-late', createdAt: PR_CREATED + 6 * 60_000, modifiedAt: PR_CREATED });
    const reversedLife = candidate({ sessionId: 'reversed', createdAt: PR_CREATED + 60_000, modifiedAt: PR_CREATED - 60_000 });
    const result = buildWorkLinks([pr()], [], { prs: new Map([[PR_URL, search(later, tooOld, tooLate, reversedLife, earliest)]]), tasks: new Map() }, new Set());

    expect(result.prs[0]?.links?.sessions).toMatchObject([{ sessionId: 'earliest', reason: 'probably opened this PR (the earliest Session that mentions it)' }]);
  });

  it('WORK-4.2: a cut off PR search names no opener, and a longer PR number never counts', () => {
    const longer = candidate({ sessionId: 'longer', firstPrompt: `${PR_URL}3`, createdAt: PR_CREATED - 30_000 });
    const complete = buildWorkLinks([pr()], [], { prs: new Map([[PR_URL, search(longer)]]), tasks: new Map() }, new Set());
    expect(complete.prs[0]?.links?.sessions).toEqual([]);

    const cutOff = buildWorkLinks([pr()], [], { prs: new Map([[PR_URL, { ...search(candidate({ sessionId: 'opener' })), incomplete: true }]]), tasks: new Map() }, new Set());
    expect(cutOff.prs[0]?.links?.sessions).toEqual([]);
    expect(cutOff.prs[0]?.links?.incomplete).toBe(true);
  });

  it('WORK-4.2: a PR URL beyond 200,000 characters is started on and cannot be inferred as an opener', () => {
    const parsed = parseSessionSearch(JSON.stringify({ results: [{
      session_id: 'late-url', first_prompt: `${'x'.repeat(200_001)} ${PR_URL}`,
      created_at: new Date(PR_CREATED - 60_000).toISOString(),
      modified_at: new Date(PR_CREATED + 60_000).toISOString(),
    }] }));
    const result = buildWorkLinks([pr()], [], { prs: new Map([[PR_URL, parsed]]), tasks: new Map() }, new Set());
    expect(result.prs[0]?.links?.sessions).toMatchObject([{ sessionId: 'late-url', reason: 'started on this PR' }]);
  });

  it('WORK-4.3: links every Session started on a PR or Task from a whole URL in its first prompt', () => {
    const taskId = '41000123';
    const urls = [
      `https://app.productive.io/109/tasks/${taskId}`,
      `https://app.productive.io/109-productive/tasks/${taskId}`,
      `https://app.productive.io/109-productive/tasks/task/${taskId}`,
      `https://app.fantastic.productive.io/109/tasks/${taskId}`,
      `https://app.fantastic.productive.io/109-productive/tasks/${taskId}`,
      `https://app.fantastic.productive.io/109-anything/tasks/${taskId}`,
      `https://app.fantastic.productive.io/109-productive/home?task=${taskId}`,
      `https://app.fantastic.productive.io/109-productive/home?view=board&task=${taskId}#comments`,
    ];
    const sessions = urls.map((url, i) => candidate({ sessionId: `task-${i}`, firstPrompt: `Start here: ${url}` }));
    const taskResult = buildWorkLinks([], [task()], { prs: new Map(), tasks: new Map([[taskId, search(...sessions)]]) }, new Set());
    expect(taskResult.tasks[0]?.links?.sessions).toHaveLength(8);
    expect(taskResult.tasks[0]?.links?.sessions.map((s) => s.reason)).toEqual(Array(8).fill('started on this Task'));

    const prStarted = candidate({ sessionId: 'pr-start', firstPrompt: `Review ${PR_URL}/files` });
    const prResult = buildWorkLinks([pr()], [], { prs: new Map([[PR_URL, search(prStarted)]]), tasks: new Map() }, new Set());
    expect(prResult.prs[0]?.links?.sessions).toMatchObject([{ sessionId: 'pr-start', reason: 'started on this PR' }]);
  });

  it('WORK-4.4: a Task links Sessions started on it and every Session linked to each of its PRs', () => {
    const taskId = '41000123';
    const linkedPr = pr({ taskIds: [{ id: taskId, source: 'branch' }] });
    const opener = candidate({ sessionId: 'opener' });
    const startedOnPr = candidate({ sessionId: 'pr', firstPrompt: PR_URL });
    const startedOnTask = candidate({ sessionId: 'task', firstPrompt: `Start ${task().url}` });
    const result = buildWorkLinks(
      [linkedPr],
      [task()],
      { prs: new Map([[PR_URL, search(opener, startedOnPr)]]), tasks: new Map([[taskId, search(startedOnTask)]]) },
      new Set(['pr']),
    );

    expect(result.tasks[0]?.links?.sessions).toMatchObject([
      { sessionId: 'task', reason: 'started on this Task', live: false },
      { sessionId: 'pr', reason: 'through PR #12', live: true },
      { sessionId: 'opener', reason: 'through PR #12', live: false },
    ]);
  });

  it('WORK-4.5: each Link carries its plain reason and cut off searches add the incomplete reason', () => {
    const taskId = '41000123';
    const linkedPr = pr({ taskIds: [{ id: taskId, source: 'branch' }, { id: taskId, source: 'body' }] });
    const started = candidate({ sessionId: 'started', firstPrompt: PR_URL });
    const result = buildWorkLinks(
      [linkedPr],
      [task()],
      { prs: new Map([[PR_URL, { ...search(started), incomplete: true }]]), tasks: new Map([[taskId, search()]]) },
      new Set(),
    );

    expect(result.prs[0]?.links?.tasks[0]).toMatchObject({ sources: ['branch', 'body'] });
    expect(result.tasks[0]?.links?.prs[0]).toMatchObject({ sources: ['branch', 'body'] });
    expect(result.prs[0]?.links?.sessions[0]?.reason).toBe('started on this PR');
    expect(result.prs[0]?.links?.incomplete).toBe(true);
    expect(result.tasks[0]?.links?.sessions[0]?.reason).toBe('through PR #12');
    expect(result.tasks[0]?.links?.incomplete).toBe(true);
  });

  it('WORK-4.6: later PR mentions can only infer an opener; later Task text and branches never make Links', () => {
    const later = candidate({ sessionId: 'later', firstPrompt: 'Please finish task 41000123', gitBranch: 'feature/41000123' } as Partial<LinkCandidate> & { sessionId: string });
    const result = buildWorkLinks([pr()], [task()], { prs: new Map([[PR_URL, search(later)]]), tasks: new Map([[task().id, search(later)]]) }, new Set());

    expect(result.tasks[0]?.links?.sessions).toEqual([]);
    expect(result.prs[0]?.links?.sessions).toMatchObject([{ sessionId: 'later', reason: 'probably opened this PR (the earliest Session that mentions it)' }]);
  });

  it('WORK-4.7: matches whole URLs ignoring ASCII case and rejects suffix letters, digits, underscores and hyphens', () => {
    expect(containsWholeUrl(`Review ${PR_URL.toUpperCase()}/files`, PR_URL)).toBe(true);
    for (const suffix of ['a', '3', '_', '-']) expect(containsWholeUrl(`${PR_URL}${suffix}`, PR_URL)).toBe(false);
    expect(containsWholeUrl(`${PR_URL}#issuecomment-1`, PR_URL)).toBe(true);
    expect(containsTaskUrl(`https://app.fantastic.productive.io/109-productive/tasks/41000123abc`, '41000123')).toBe(false);
    expect(containsTaskUrl(`https://app.fantastic.productive.io/109-productive/home?task=41000123.`, '41000123')).toBe(true);
    expect(containsTaskUrl(`https://app.fantastic.productive.io/109-productive/home?task=41000123abc`, '41000123')).toBe(false);
    expect(containsTaskUrl(`https://app.fantastic.productive.io/1090-productive/tasks/41000123`, '41000123')).toBe(false);
    expect(containsTaskUrl(`https://app.fantastic.productive.io/109-productive/home?subtask=41000123`, '41000123')).toBe(false);
    expect(containsTaskUrl(`https://app.fantastic.productive.io/109/home?task=111,https://app.fantastic.productive.io/109/home?task=41000123`, '41000123')).toBe(true);
  });

  it('WORK-4.3: ignores indexed rows without a first prompt so they cannot be called an opener', () => {
    const session = { session_id: 'missing-prompt', created_at: '2026-10-21T11:59:00Z', modified_at: '2026-10-21T12:00:00Z' };
    expect(parseSessionSearch(JSON.stringify({ results: [session] })).sessions).toEqual([]);
  });

  it('WORK-4.8: parses up to 200 Sessions and marks a full result incomplete', () => {
    const results = Array.from({ length: 200 }, (_, i) => ({
      session_id: `session-${i}`,
      first_prompt: 'Fix the lanterns',
      created_at: '2026-10-20T10:00:00Z',
      modified_at: '2026-10-21T10:00:00Z',
    }));
    expect(parseSessionSearch(JSON.stringify({ results })).incomplete).toBe(true);
    expect(parseSessionSearch(JSON.stringify({ results: results.slice(0, 199) })).incomplete).toBe(false);
  });

  it('WORK-7.7: redacts token-like text from a linked Session summary and first-prompt title fallback', () => {
    const taskId = '41000123';
    const parsed = parseSessionSearch(JSON.stringify({ results: [
      {
        session_id: 'summary-secret',
        summary: 'Review ghp_FAKEgithubtoken123 access_token=private Authorization: Bearer headersecret',
        first_prompt: `Start ${task().url}`,
      },
      {
        session_id: 'prompt-secret',
        first_prompt: `Start ${task().url} with github_pat_FAKEgithubpat123 client_secret=private`,
      },
    ] }));
    const result = buildWorkLinks([], [task()], { prs: new Map(), tasks: new Map([[taskId, parsed]]) }, new Set());
    const output = JSON.stringify(result);

    for (const secret of ['ghp_FAKEgithubtoken123', 'private', 'headersecret', 'github_pat_FAKEgithubpat123']) {
      expect(output).not.toContain(secret);
    }
    expect(result.tasks[0]?.links?.sessions).toHaveLength(2);
  });
});
