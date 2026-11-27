import type { PlainSource } from '@shared/plain.ts';
import { isPersonName } from '@shared/people.ts';
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
  | { name: 'plain-pr'; repo: string; number: number; path: string }
  /** DOC-1.1: a file in the Document view, by its absolute path; `session` when it was opened from that Session's chat, `person` from that Person's page (PEOPLE-4.4). */
  | { name: 'doc'; path: string; session?: string; person?: string }
  /** NAV-2.2, INBOX-2.1: the Inbox, with the open Report's run and, past its first, the open document (INBOX-2.3). */
  | { name: 'inbox'; id?: string; doc?: number }
  /** PEOPLE-3.1: People, with the Person whose page shows: their folder's name. */
  | { name: 'people'; person?: string };

/** PLAIN-1.1, PLAIN-5: the Spec view's route for a Module of this source. */
export function plainRoute(source: PlainSource, path: string): Route {
  return source.kind === 'pr' ? { name: 'plain-pr', repo: source.repo, number: source.number, path } : { name: 'plain', session: source.session, checkout: source.checkout, path };
}

/** SIDE-7.6: Settings' sub-pages, in the side nav's order. */
export const SETTINGS_SECTIONS = ['general', 'tools', 'vault'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** TOPIC-10.7: a Topic view's tabs, in their order. */
export const TOPIC_TABS = ['overview', 'members', 'activity'] as const;
export type TopicTab = (typeof TOPIC_TABS)[number];

/** VIEW-1.18's plain path, absolute: no control or invisible character, no `~`, no `:`, at most 1,024 characters. */
const isDocumentPath = (path: string) => path.startsWith('/') && path.length <= 1024 && !/[\p{Cc}\p{Cf}~:]/u.test(path);

export function parseRoute(pathname: string): Route {
  // NAV-2.2: the Inbox; INBOX-2.3: a document past the first is `/<n>`, from 2 up; anything else is the first.
  const inbox = /^\/inbox(?:\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/([^/]*))?)?\/?$/.exec(pathname);
  if (inbox) {
    if (!inbox[1]) return { name: 'inbox' };
    const doc = /^[1-9][0-9]{0,2}$/.test(inbox[2] ?? '') ? Number(inbox[2]) : 1;
    return doc > 1 ? { name: 'inbox', id: inbox[1], doc } : { name: 'inbox', id: inbox[1] };
  }
  // PEOPLE-4.4: a note opened from a Person's page, at that Person's path; an odd name or path is People's start.
  const note = /^\/people\/([^/]+)\/doc\/([^/]+)\/?$/.exec(pathname);
  if (note) {
    try {
      const person = decodeURIComponent(note[1]!);
      const path = decodeURIComponent(note[2]!);
      return isPersonName(person) && isDocumentPath(path) ? { name: 'doc', path, person } : { name: 'people' };
    } catch {
      return { name: 'people' };
    }
  }
  // PEOPLE-3.1: People; a name no Person's folder could have is the list alone.
  const people = /^\/people(?:\/([^/]*))?\/?$/.exec(pathname);
  if (people) {
    try {
      const person = people[1] ? decodeURIComponent(people[1]) : '';
      return person && isPersonName(person) ? { name: 'people', person } : { name: 'people' };
    } catch {
      return { name: 'people' };
    }
  }
  // SIDE-7.6: any other sub-page is General.
  const settings = /^\/settings(?:\/([^/]*))?\/?$/.exec(pathname);
  if (settings) return (SETTINGS_SECTIONS as readonly string[]).includes(settings[1] ?? '') ? { name: 'settings', section: settings[1] as SettingsSection } : { name: 'settings' };
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
  // DOC-1.1: the file's path is one encoded segment; one that isn't absolute and plain is the start page.
  const doc = /^(?:\/s\/([^/]+))?\/doc\/([^/]+)\/?$/.exec(pathname);
  if (doc) {
    try {
      const path = decodeURIComponent(doc[2]!);
      if (!isDocumentPath(path)) return { name: 'home' };
      return doc[1] ? { name: 'doc', path, session: decodeURIComponent(doc[1]) } : { name: 'doc', path };
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
    case 'inbox':
      return route.id ? `/inbox/${route.id}${route.doc && route.doc > 1 ? `/${route.doc}` : ''}` : '/inbox';
    case 'people':
      return route.person ? `/people/${encodeURIComponent(route.person)}` : '/people';
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
    case 'doc':
      return `${route.session ? `/s/${encodeURIComponent(route.session)}` : route.person ? `/people/${encodeURIComponent(route.person)}` : ''}/doc/${encodeURIComponent(route.path)}`;
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

const depth = (): number => {
  const i = (window.history.state as { i?: unknown } | null)?.i;
  return typeof i === 'number' && i > 0 ? i : 0;
};
/** DOC-2.4: whether the entry before this one in the tab's history is Lookout's own, so going back stays in Lookout. */
export const canGoBack = (): boolean => depth() > 0;

/** Goes to a route from anywhere: what `useRoute`'s navigate does. A link in the chat has no App to ask (DOC-1.4). */
export const navigateTo: Navigate = (route, opts) => {
  const to = routePath(route);
  if (to === window.location.pathname) return;
  // PLAIN-7.2: a place in the page, which the path never carries.
  const next = opts?.hash ? `${to}#${opts.hash}` : to;
  // DOC-2.4: each entry knows how many of Lookout's own came before it in this tab, so a view can go back to one.
  const before = depth();
  if (opts?.replace) window.history.replaceState(before > 0 ? { i: before } : null, '', next);
  else window.history.pushState({ i: before + 1 }, '', next);
  window.dispatchEvent(new Event(NAVIGATE));
};

export function useRoute(): [Route, Navigate] {
  const path = useSyncExternalStore(subscribe, getPath);
  const navigate = useCallback<Navigate>((route, opts) => navigateTo(route, opts), []);
  return [parseRoute(path), navigate];
}
