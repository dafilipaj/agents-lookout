import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './client';

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
