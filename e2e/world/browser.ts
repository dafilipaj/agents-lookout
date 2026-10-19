import type { BrowserContext, Request } from '@playwright/test';

/**
 * TEST-1.7: a World's pages reach only its own Lookout. Every request a page of the test's browser
 * context makes outside the World's Lookout origin is aborted and its URL recorded, popups and new
 * tabs included: a route on the context covers every page it opens. WebSockets, which routes don't
 * see, are refused the same way. So a link that opens GitHub or Fantastic shows its URL to the test
 * (`world.browserRequests()`) without loading it.
 *
 * A route sees only a redirect's first URL, and a page's own route goes before the context's, so
 * the guard also watches every request the browser issues: an outside one its route didn't abort
 * (a redirect hop, or one a test's route let through) is an escape, which fails the test. The
 * browser has no way out for it either (e2e/playwright.config.ts).
 *
 * Until the World says which origin is its own, nothing passes.
 */
export class BrowserGuard {
  private origin: string | null = null;
  private readonly refused: string[] = [];
  /** The requests the guard's route aborted. Playwright hands the route the request it emitted. */
  private readonly aborted = new WeakSet<Request>();
  /** Every HTTP request for an outside URL, as the browser issued it, redirect hops included. */
  private readonly outsideRequests: Request[] = [];

  /** The World's Lookout origin, `http://127.0.0.1:<port>`: the only one its pages reach. */
  allow(origin: string): void {
    this.origin = origin;
  }

  private outside(url: URL): boolean {
    // A WebSocket to the World's Lookout is the same server as its HTTP origin.
    const origin = url.protocol === 'ws:' || url.protocol === 'wss:' ? `${url.protocol === 'ws:' ? 'http:' : 'https:'}//${url.host}` : url.origin;
    return origin !== this.origin;
  }

  /** Routes every page `context` has or opens through the guard, and watches what gets past it. */
  async watch(context: BrowserContext): Promise<void> {
    // Emitted before the request is routed, so it is registered first.
    context.on('request', (request) => {
      const url = new URL(request.url());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && this.outside(url)) this.outsideRequests.push(request);
    });
    await context.route(
      (url) => this.outside(url),
      async (route) => {
        this.aborted.add(route.request());
        this.refused.push(route.request().url());
        await route.abort('blockedbyclient');
      },
    );
    await context.routeWebSocket(
      (url) => this.outside(url),
      async (ws) => {
        this.refused.push(ws.url());
        await ws.close({ code: 1008, reason: 'outside the World' });
      },
    );
  }

  /** The URLs refused so far, in the order the pages asked for them. */
  requests(): string[] {
    return [...this.refused];
  }

  /** Outside requests the route never aborted, each with the URL that redirected to it, if any. */
  escapes(): { url: string; redirectedFrom?: string }[] {
    return this.outsideRequests
      .filter((r) => !this.aborted.has(r))
      .map((r) => {
        const from = r.redirectedFrom();
        return from ? { url: r.url(), redirectedFrom: from.url() } : { url: r.url() };
      });
  }
}
