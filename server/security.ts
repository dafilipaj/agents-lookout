import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const TOKEN_HEADER = 'x-lookout-token';

export interface GuardConfig {
  /** `Host` header values this server answers to (blocks DNS rebinding). */
  allowedHosts: ReadonlySet<string>;
  /** `Origin` values allowed: the app's own, plus Vite's in `pnpm dev`. */
  allowedOrigins: ReadonlySet<string>;
  token: string;
}

export type GuardResult = { ok: true } | { ok: false; status: number; reason: string };

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Decision 0003: the server can start and kill processes, so CORS alone isn't trusted.
 * - Every request: a known `Host`; an `Origin`, when sent, must be ours; and the browser's
 *   `Sec-Fetch-Site`, when sent, must not say another site made the request.
 * - Mutating requests additionally need our `Origin` and the token.
 */
export function guardRequest(req: IncomingMessage, cfg: GuardConfig): GuardResult {
  const host = req.headers.host;
  if (!host || !cfg.allowedHosts.has(host.toLowerCase())) {
    return { ok: false, status: 403, reason: 'unknown host' };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !cfg.allowedOrigins.has(origin)) {
    return { ok: false, status: 403, reason: 'foreign origin' };
  }
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') {
    return { ok: false, status: 403, reason: 'cross-site request' };
  }
  if (!SAFE_METHODS.has(req.method ?? 'GET')) {
    if (origin === undefined) return { ok: false, status: 403, reason: 'missing origin' };
    const sent = req.headers[TOKEN_HEADER];
    if (typeof sent !== 'string' || !tokensEqual(sent, cfg.token)) {
      return { ok: false, status: 403, reason: 'bad token' };
    }
  }
  return { ok: true };
}

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Host and Origin allow-lists for a server on 127.0.0.1:<port>. */
export function localAllowLists(port: number, extraOrigins: readonly string[] = []) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return {
    allowedHosts: new Set(hosts),
    allowedOrigins: new Set([...hosts.map((h) => `http://${h}`), ...extraOrigins]),
  };
}
