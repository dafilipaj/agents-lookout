import { useCallback, useSyncExternalStore } from 'react';

/** The app's URLs. The selected Session lives in the path, so reload and back/forward keep it (SIDE-4.2). */
export type Route = { name: 'home' } | { name: 'session'; id: string } | { name: 'settings' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/settings') return { name: 'settings' };
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
    case 'session':
      return `/s/${encodeURIComponent(route.id)}`;
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
