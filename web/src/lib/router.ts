import type { PlainSource } from '@shared/plain.ts';
import type { Harness } from '@shared/types.ts';
import { useCallback, useSyncExternalStore } from 'react';

/** The app's URLs. The selected Session lives in the path, so reload and back/forward keep it (SIDE-4.2). */
export type Route =
  | { name: 'home' }
  | { name: 'session'; id: string }
  /** SIDE-7.6: a Settings sub-page; none is General. */
  | { name: 'settings'; section?: SettingsSection }
  /** TOPIC-7: the Topics graph, in place of the Session view. */
  | { name: 'topics' }
  /** TOPIC-14.1: the Suggest view. */
  | { name: 'suggest' }
  /** TOPIC-10: one Topic's view. */
  /** TOPIC-10.8: the open tab is in the path; none is Overview. */
  | { name: 'topic'; id: string; tab?: TopicTab }
  /** HIST-3.3: a past Session that can't be resumed, read-only. */
  | { name: 'past'; harness: Harness; id: string }
  /** LAUNCH-4.2 / 4.6: a "Starting…" row, selected until its Session takes over. */
  | { name: 'launch'; id: string }
  /** PLAIN-1.1: a Module of a live Session's Checkout, by the Checkout's id (never its path). */
  | { name: 'plain'; session: string; checkout: string; path: string }
  /** PLAIN-5: a Module of a PR, by its repo (in `productiveio`) and number. */
  | { name: 'plain-pr'; repo: string; number: number; path: string };

/** PLAIN-1.1, PLAIN-5: the Spec view's route for a Module of this source. */
export function plainRoute(source: PlainSource, path: string): Route {
  return source.kind === 'pr' ? { name: 'plain-pr', repo: source.repo, number: source.number, path } : { name: 'plain', session: source.session, checkout: source.checkout, path };
}

/** SIDE-7.6: Settings' sub-pages, in the side nav's order. */
export const SETTINGS_SECTIONS = ['general', 'tools'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** TOPIC-10.7: a Topic view's tabs, in their order. */
export const TOPIC_TABS = ['overview', 'members', 'activity'] as const;
export type TopicTab = (typeof TOPIC_TABS)[number];

export function parseRoute(pathname: string): Route {
  // SIDE-7.6: any other sub-page is General.
  const settings = /^\/settings(?:\/([^/]*))?\/?$/.exec(pathname);
  if (settings) return settings[1] === 'general' || settings[1] === 'tools' ? { name: 'settings', section: settings[1] } : { name: 'settings' };
  if (pathname === '/topics' || pathname === '/topics/') return { name: 'topics' };
  if (pathname === '/topics/suggest' || pathname === '/topics/suggest/') return { name: 'suggest' };
  // TOPIC-10.8: any other tab is Overview.
  const topic = /^\/topics\/([^/]+)(?:\/([^/]*))?\/?$/.exec(pathname);
  if (topic?.[1]) {
    try {
      const id = decodeURIComponent(topic[1]);
      return topic[2] === 'members' || topic[2] === 'activity' ? { name: 'topic', id, tab: topic[2] } : { name: 'topic', id };
    } catch {
      return { name: 'home' };
    }
  }
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
  const pr = /^\/plain\/pr\/([A-Za-z0-9._-]{1,100})\/([1-9][0-9]{0,9})\/([^/]+)\/?$/.exec(pathname);
  if (pr) {
    try {
      return { name: 'plain-pr', repo: pr[1]!, number: Number(pr[2]), path: decodeURIComponent(pr[3]!) };
    } catch {
      return { name: 'home' };
    }
  }
  const plain = /^\/plain\/([^/]+)\/([0-9a-f]{16})\/([^/]+)\/?$/.exec(pathname);
  if (plain) {
    try {
      return { name: 'plain', session: decodeURIComponent(plain[1]!), checkout: plain[2]!, path: decodeURIComponent(plain[3]!) };
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
      return route.section ? `/settings/${route.section}` : '/settings';
    case 'topics':
      return '/topics';
    case 'suggest':
      return '/topics/suggest';
    case 'topic':
      return `/topics/${encodeURIComponent(route.id)}${route.tab && route.tab !== 'overview' ? `/${route.tab}` : ''}`;
    case 'session':
      return `/s/${encodeURIComponent(route.id)}`;
    case 'past':
      return `/h/${route.harness}/${encodeURIComponent(route.id)}`;
    case 'launch':
      return `/l/${encodeURIComponent(route.id)}`;
    case 'plain':
      return `/plain/${encodeURIComponent(route.session)}/${route.checkout}/${encodeURIComponent(route.path)}`;
    case 'plain-pr':
      return `/plain/pr/${route.repo}/${route.number}/${encodeURIComponent(route.path)}`;
  }
}

/** PLAIN-7.2: a spec's anchor in the Spec view, and the URL hash that opens a Module at it. */
export const specHash = (id: string) => `plain-s-${id.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

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

export type Navigate = (route: Route, opts?: { replace?: boolean; hash?: string }) => void;

export function useRoute(): [Route, Navigate] {
  const path = useSyncExternalStore(subscribe, getPath);
  const navigate = useCallback<Navigate>((route, opts) => {
    const to = routePath(route);
    if (to === window.location.pathname) return;
    // PLAIN-7.2: a place in the page, which the path never carries.
    const next = opts?.hash ? `${to}#${opts.hash}` : to;
    if (opts?.replace) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
    window.dispatchEvent(new Event(NAVIGATE));
  }, []);
  return [parseRoute(path), navigate];
}
