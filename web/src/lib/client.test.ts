import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_FAILED, REFRESH_NOT_WATCHED, SaveError, createHttpClient } from './client';

type Pending = { url: string; init: RequestInit | undefined; resolve: (r: Response) => void };

let pending: Pending[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pending = [];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/bootstrap') return Promise.resolve(Response.json({ token: 'tok' }));
    return new Promise<Response>((resolve) => pending.push({ url, init, resolve }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const puts = () => pending.filter((p) => p.url === '/api/watch');
const body = (p: Pending) => JSON.parse(String(p.init?.body));
const bootstraps = () => fetchMock.mock.calls.filter(([u]) => u === '/api/bootstrap').length;

describe('telling the server what the tab views', () => {
  it('sends one watch at a time, then only the latest wanted state', async () => {
    const client = createHttpClient();
    void client.watch('tab-1', 'a', false);
    void client.watch('tab-1', 'a', true);
    void client.watch('tab-1', 'b', false);
    await settle();
    expect(puts()).toHaveLength(1);
    expect(body(puts()[0]!)).toEqual({ clientId: 'tab-1', sessionId: 'a', preview: false });

    puts()[0]!.resolve(Response.json({ ok: true }));
    await settle();
    await settle();
    expect(puts()).toHaveLength(2);
    expect(body(puts()[1]!)).toEqual({ clientId: 'tab-1', sessionId: 'b', preview: false }); // a/true skipped: stale
    puts()[1]!.resolve(Response.json({ ok: true }));
    await settle();
    expect(puts()).toHaveLength(2);
  });

  it('retries a failed watch until the server has it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const client = createHttpClient();
    void client.watch('tab-1', 'a', true);
    await vi.advanceTimersByTimeAsync(0);
    puts()[0]!.resolve(new Response('{}', { status: 500 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(puts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(puts()).toHaveLength(2);
    expect(body(puts()[1]!)).toEqual({ clientId: 'tab-1', sessionId: 'a', preview: true });
  });

  it('a new wanted state doesn’t wait out a retry delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const client = createHttpClient();
    void client.watch('tab-1', 'a', false);
    await vi.advanceTimersByTimeAsync(0);
    puts()[0]!.resolve(new Response('{}', { status: 500 })); // a blip: retry in 1 s
    await vi.advanceTimersByTimeAsync(100);
    void client.watch('tab-1', 'a', true); // the drawer opens meanwhile
    await vi.advanceTimersByTimeAsync(0);
    expect(puts()).toHaveLength(2);
    expect(body(puts()[1]!)).toEqual({ clientId: 'tab-1', sessionId: 'a', preview: true });
  });

  it('fetches the token once for requests made at the same time', async () => {
    const client = createHttpClient();
    void client.watch('tab-1', 'a', true);
    void client.saveSettings({ idleThresholdHours: 2 });
    void client.sendMessage('a', 'hi');
    await settle();
    await settle();
    expect(bootstraps()).toBe(1);
    expect(pending.map((p) => p.url).sort()).toEqual(['/api/sessions/a/send', '/api/settings', '/api/watch']);
  });
});

describe('Work (WORK-8)', () => {
  const workPuts = () => pending.filter((p) => p.url === '/api/work/watch');

  it('WORK-8.1 (support): says whether Work is open one request at a time, then only the latest; a gone stream is not retried', async () => {
    const client = createHttpClient();
    void client.watchWork('tab-1', true);
    void client.watchWork('tab-1', false);
    void client.watchWork('tab-1', true);
    await settle();
    expect(workPuts()).toHaveLength(1);
    expect(workPuts()[0]!.init?.method).toBe('PUT');
    expect(body(workPuts()[0]!)).toEqual({ clientId: 'tab-1', open: true });
    workPuts()[0]!.resolve(Response.json({ ok: true }));
    await settle();
    await settle();
    expect(workPuts()).toHaveLength(1); // the latest is what the server already has
    void client.watchWork('tab-1', false);
    await settle();
    await settle();
    expect(workPuts()).toHaveLength(2);
    workPuts()[1]!.resolve(Response.json({ error: 'unknown event stream' }, { status: 404 }));
    await settle();
    await settle();
    expect(workPuts()).toHaveLength(2);
  });

  it('WORK-8.2 (support): Refresh answers with the read’s outcome, or the refusal with when it’s back; a 409, a server error or no server rejects in plain words', async () => {
    const client = createHttpClient();
    const first = client.refreshWork();
    await settle();
    await settle();
    const post = () => pending.filter((p) => p.url === '/api/work/refresh');
    expect(post()[0]!.init?.method).toBe('POST');
    post()[0]!.resolve(Response.json({ ok: false, error: 'tb-pr took too long to answer. Try Refresh later.' }));
    await expect(first).resolves.toEqual({ ok: false, error: 'tb-pr took too long to answer. Try Refresh later.' });
    const second = client.refreshWork();
    await settle();
    await settle();
    post()[1]!.resolve(Response.json({ ok: false, error: 'Refresh was used less than a minute ago', until: 123 }, { status: 429 }));
    await expect(second).resolves.toEqual({ ok: false, error: 'Refresh was used less than a minute ago', until: 123 });
    // While the server doesn't know yet that this tab has Work open, it refuses (WORK-8.1): said in plain words.
    const third = client.refreshWork();
    await settle();
    await settle();
    post()[2]!.resolve(Response.json({ ok: false, error: "Work isn't open in any tab" }, { status: 409 }));
    await expect(third).rejects.toMatchObject({ message: REFRESH_NOT_WATCHED, status: 409, lost: false });
    // A server error, and something in between answering for the server.
    const fourth = client.refreshWork();
    await settle();
    await settle();
    post()[3]!.resolve(Response.json({ ok: false, error: 'Refresh failed' }, { status: 500 }));
    await expect(fourth).rejects.toMatchObject({ message: REFRESH_FAILED, status: 500, lost: false });
    const fifth = client.refreshWork();
    await settle();
    await settle();
    post()[4]!.resolve(new Response('Bad gateway', { status: 502 }));
    await expect(fifth).rejects.toMatchObject({ message: "Couldn't reach the Lookout server.", status: 502, lost: true });
  });
});

describe('sending and pressing Esc (VIEW-3.7, VIEW-4.5)', () => {
  it('VIEW-3.7: a held send rejects with its reason, which only a known one sets; nothing else from the server rides along', async () => {
    const client = createHttpClient();
    const held = (payload: unknown) => {
      const sent = client.sendMessage('a', 'Reply with OK').catch((e: unknown) => e);
      return { sent, answer: async () => {
        await settle();
        pending.at(-1)!.resolve(Response.json(payload, { status: 409 }));
        return sent;
      } };
    };
    const known = await held({ error: 'The Session is waiting on a prompt, so nothing was sent. Answer it, then try again.', field: null, kind: 'send_held', reason: 'prompt' }).answer();
    expect(known).toBeInstanceOf(SaveError);
    expect(known).toMatchObject({ status: 409, kind: 'send_held', reason: 'prompt', lost: false, message: 'The Session is waiting on a prompt, so nothing was sent. Answer it, then try again.' });
    const unknown = await held({ error: 'Fleet held the message, so nothing was sent. Check the terminal.', field: null, kind: 'send_held', reason: 'overlay' }).answer();
    expect(unknown).toMatchObject({ kind: 'send_held', reason: null });
    expect(pending.at(-1)!.url).toBe('/api/sessions/a/send');
  });

  it('VIEW-4.5: Esc posts to Stop’s route with the Status it was shown in; Stop posts no body', async () => {
    const client = createHttpClient();
    void client.escSession('a b');
    await settle();
    expect(pending.at(-1)!.url).toBe('/api/sessions/a%20b/stop');
    expect(pending.at(-1)!.init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', 'x-lookout-token': 'tok' } });
    expect(body(pending.at(-1)!)).toEqual({ status: 'needs-you' });
    pending.at(-1)!.resolve(Response.json({ ok: true }));
    void client.stopSession('a');
    await settle();
    expect(pending.at(-1)!.url).toBe('/api/sessions/a/stop');
    expect(pending.at(-1)!.init?.body).toBeUndefined();
  });
});

describe('memory watches', () => {
  it('MEM-3.1: sends the latest open state in order, retries failures, and transfers the watch after reconnecting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const client = createHttpClient();
    const memoryPuts = () => pending.filter((p) => p.url === '/api/memory/watch');
    void client.watchMemory('tab-1', true);
    void client.watchMemory('tab-1', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(memoryPuts()).toHaveLength(1);
    expect(body(memoryPuts()[0]!)).toEqual({ clientId: 'tab-1', open: true });
    expect(memoryPuts()[0]!.init?.method).toBe('PUT');
    memoryPuts()[0]!.resolve(Response.json({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(body(memoryPuts()[1]!)).toEqual({ clientId: 'tab-1', open: false });
    memoryPuts()[1]!.resolve(Response.json({}, { status: 500 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(body(memoryPuts()[2]!)).toEqual({ clientId: 'tab-1', open: false });
    memoryPuts()[2]!.resolve(Response.json({}, { status: 404 }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(memoryPuts()).toHaveLength(3);
    void client.watchMemory('tab-2', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(body(memoryPuts()[3]!)).toEqual({ clientId: 'tab-2', open: true });
    memoryPuts()[3]!.resolve(Response.json({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
});
