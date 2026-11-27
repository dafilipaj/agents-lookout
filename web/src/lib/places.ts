import type { Route } from './router';

/** NAV: Lookout's places, in the rail's order ([0017](docs/decisions/0017-one-app-for-both-roles.md)). */
export const PLACES = ['inbox', 'sessions', 'people'] as const;
export type Place = (typeof PLACES)[number];
export const PLACE_LABEL: Record<Place, string> = { inbox: 'Inbox', sessions: 'Sessions', people: 'People' };
/** NAV-4.1, PEOPLE-3.1: the key that shows each place. */
export const PLACE_KEY: Record<Place, string> = { inbox: '1', sessions: '2', people: '3' };
/** NAV-2.4: where a place starts when nothing was left open there. */
export const PLACE_START: Record<Place, Route> = { inbox: { name: 'inbox' }, sessions: { name: 'home' }, people: { name: 'people' } };

/**
 * NAV-2.1 to 2.3: the place a route belongs to. The Inbox's routes are the Inbox's and People's are
 * People's (PEOPLE-3.1); Settings, the
 * Topics graph, a Topic view, the Suggest view and a document not opened from a Session (DOC-2.6)
 * belong to none, so the place before them stays; everything else is Sessions'.
 */
export function placeOfRoute(route: Route, last: Place): Place {
  switch (route.name) {
    case 'inbox':
      return 'inbox';
    case 'people':
      return 'people';
    case 'settings':
    case 'topics':
    case 'topic':
    case 'suggest':
      return last;
    // DOC-2.6: a document opened from a Session's chat is Sessions', one from a Person's page People's (PEOPLE-4.4); any other keeps the place before it.
    case 'doc':
      return route.session ? 'sessions' : route.person ? 'people' : last;
    default:
      return 'sessions';
  }
}

/** NAV-2.3: whether a route is a place's own, so it's where that place was left (NAV-2.4). */
export const ownsRoute = (route: Route): boolean => placeOfRoute(route, 'inbox') === placeOfRoute(route, 'sessions');

const KEY = 'lookout.place';

/**
 * NAV-2.3: the place last shown in this browser tab, so a reload keeps it; anything odd, or no
 * storage, is Sessions. The tab's own storage: a tab that never showed a place starts on Sessions,
 * whatever another tab shows.
 */
export function loadPlace(): Place {
  try {
    const v = window.sessionStorage.getItem(KEY);
    return (PLACES as readonly string[]).includes(v ?? '') ? (v as Place) : 'sessions';
  } catch {
    return 'sessions';
  }
}

export function savePlace(place: Place): void {
  try {
    window.sessionStorage.setItem(KEY, place);
  } catch {
    // no storage here: it's only a convenience
  }
}
