import type { Harness } from '@shared/types.ts';
import { useCallback, useSyncExternalStore } from 'react';

/** The app's URLs. The selected Session lives in the path, so reload and back/forward keep it (SIDE-4.2). */
export type Route =
  | { name: 'home' }
  | { name: 'session'; id: string }
  | { name: 'settings' }
  /** TOPIC-7: the Topics graph, in place of the Session view. */
  | { name: 'topics' }
  /** HIST-3.3: a past Session that can't be resumed, read-only. */
  | { name: 'past'; harness: Harness; id: string }
  /** LAUNCH-4.2 / 4.6: a "Starting…" row, selected until its Session takes over. */
  | { name: 'launch'; id: string };

export function parseRoute(pathname: string): Route {
  if (pathname === '/settings') return { name: 'settings' };
  if (pathname === '/topics' || pathname === '/topics/') return { name: 'topics' };
  const past = /^\/h\/(claude|codex)\/([^/]+)\/?$/.exec(pathname);
  if (past?.[2]) {
    try {
      return { name: 'past', harness: past[1] as Harness, id: decodeURIComponent(past[2]) };
    } catch {
      return { name: 'home' };
    }
  }
  const launch = /^\/l\/([^/]+)\/?$/.exec(pathname);
  if (launch?.[1]) {
    try {
      return { name: 'launch', id: decodeURIComponent(launch[1]) };
    } catch {
      return { name: 'home' };
    }
  }
  const m = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (m?.[1]) {
    try {
      return { name: 'session', id: decodeURIComponent(m[1]) };
    } catch {
      return { name: 'home' };
    }
  }
  return { name: 'home' };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'settings':
      return '/settings';
    case 'topics':
      return '/topics';
    case 'session':
      return `/s/${encodeURIComponent(route.id)}`;
    case 'past':
      return `/h/${route.harness}/${encodeURIComponent(route.id)}`;
    case 'launch':
      return `/l/${encodeURIComponent(route.id)}`;
  }
}

const NAVIGATE = 'lookout:navigate';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAVIGATE, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAVIGATE, cb);
  };
}

const getPath = () => window.location.pathname;

export type Navigate = (route: Route, opts?: { replace?: boolean }) => void;

export function useRoute(): [Route, Navigate] {
  const path = useSyncExternalStore(subscribe, getPath);
  const navigate = useCallback<Navigate>((route, opts) => {
    const next = routePath(route);
    if (next === window.location.pathname) return;
    if (opts?.replace) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
    window.dispatchEvent(new Event(NAVIGATE));
  }, []);
  return [parseRoute(path), navigate];
}
