import { beforeEach, describe, expect, it } from 'vitest';
import { loadPlace, ownsRoute, placeOfRoute, savePlace } from './places';
import { parseRoute, routePath, type Route } from './router';

beforeEach(() => window.sessionStorage.clear());

describe('places and their paths', () => {
  it('NAV-2.1: every path Lookout had before the rail, the four views over a place aside, is Sessions’', () => {
    for (const path of ['/', '/s/a', '/h/claude/past-1', '/l/launch-1', '/plain/a/0123456789abcdef/crm.plain', '/plain/pr/web/12/crm.plain', '/nowhere']) {
      expect(placeOfRoute(parseRoute(path), 'inbox'), path).toBe('sessions');
    }
  });

  it('NAV-2.2: /inbox and a Report’s path are the Inbox’s; the path names the run and, past its first, the document (INBOX-2.3)', () => {
    expect(parseRoute('/inbox')).toEqual({ name: 'inbox' });
    expect(parseRoute('/inbox/')).toEqual({ name: 'inbox' });
    expect(parseRoute('/inbox/run-1')).toEqual({ name: 'inbox', id: 'run-1' });
    expect(parseRoute('/inbox/run-1/2')).toEqual({ name: 'inbox', id: 'run-1', doc: 2 });
    // Anything else after the run is its first document.
    for (const odd of ['/inbox/run-1/1', '/inbox/run-1/0', '/inbox/run-1/x', '/inbox/run-1/']) expect(parseRoute(odd), odd).toEqual({ name: 'inbox', id: 'run-1' });
    const routes: Route[] = [{ name: 'inbox' }, { name: 'inbox', id: 'run-1' }, { name: 'inbox', id: 'run-1', doc: 3 }];
    for (const route of routes) {
      expect(parseRoute(routePath(route))).toEqual(route);
      expect(placeOfRoute(route, 'sessions')).toBe('inbox');
    }
    expect(routePath({ name: 'inbox', id: 'run-1', doc: 1 })).toBe('/inbox/run-1');
  });

  it('NAV-2.3: Settings, the Topics graph, a Topic view and Suggest keep the place before them, which is kept in the browser tab', () => {
    for (const path of ['/settings', '/settings/tools', '/topics', '/topics/suggest', '/topics/11111111-1111-4111-8111-111111111111']) {
      const route = parseRoute(path);
      expect(placeOfRoute(route, 'inbox'), path).toBe('inbox');
      expect(placeOfRoute(route, 'sessions'), path).toBe('sessions');
      expect(ownsRoute(route), path).toBe(false);
    }
    expect(ownsRoute(parseRoute('/inbox'))).toBe(true);
    // INBOX-2.1: every id the store takes is a Report's path, one written by hand with an underscore too.
    expect(parseRoute('/inbox/weekly_report-1')).toEqual({ name: 'inbox', id: 'weekly_report-1' });
    expect(parseRoute('/inbox/_odd')).not.toMatchObject({ name: 'inbox' });
    expect(ownsRoute(parseRoute('/s/a'))).toBe(true);
    // Nothing kept, or something odd, is Sessions.
    expect(loadPlace()).toBe('sessions');
    savePlace('inbox');
    expect(loadPlace()).toBe('inbox');
    window.sessionStorage.setItem('lookout.place', 'people');
    expect(loadPlace()).toBe('sessions');
    // It's this tab's: what another tab kept for the whole browser isn't read.
    window.sessionStorage.clear();
    window.localStorage.setItem('lookout.place', 'inbox');
    expect(loadPlace()).toBe('sessions');
  });
});
