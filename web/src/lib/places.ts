import type { Route } from './router';

/** NAV: Lookout's places, in the rail's order ([0017](docs/decisions/0017-one-app-for-both-roles.md)). */
export const PLACES = ['inbox', 'sessions'] as const;
export type Place = (typeof PLACES)[number];
export const PLACE_LABEL: Record<Place, string> = { inbox: 'Inbox', sessions: 'Sessions' };
/** NAV-4.1: the key that shows each place. */
export const PLACE_KEY: Record<Place, string> = { inbox: '1', sessions: '2' };

/**
 * NAV-2.1 to 2.3: the place a route belongs to. The Inbox's routes are the Inbox's; Settings, the
 * Topics graph, a Topic view and the Suggest view belong to none, so the place before them stays;
 * everything else is Sessions'.
 */
export function placeOfRoute(route: Route, last: Place): Place {
  switch (route.name) {
    case 'inbox':
      return 'inbox';
    case 'settings':
    case 'topics':
    case 'topic':
    case 'suggest':
      return last;
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
