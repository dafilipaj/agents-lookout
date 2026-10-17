import { type Settings, defaultSettings } from '@shared/settings.ts';
import type { FleetHealth, LaunchView, ServerEvent, SessionRow } from '@shared/types.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import { useEffect, useReducer } from 'react';
import type { LookoutClient } from './client.ts';

export interface LookoutState {
  /** The first snapshot has arrived. */
  loaded: boolean;
  /** The event stream to the server is open. */
  connected: boolean;
  sessions: ReadonlyMap<string, SessionRow>;
  /** Every row ever seen, so an ended Session can still be described (SIDE-4.3). */
  lastKnown: ReadonlyMap<string, SessionRow>;
  /**
   * A Codex Session has no session id before its first prompt (`codex:<pid>`); when it gets one,
   * its row id changes. Old id → new id, so a selection can follow it.
   */
  aliases: ReadonlyMap<string, string>;
  fleet: FleetHealth;
  settings: Settings;
  /** Starts in flight (LAUNCH-4): "Starting…" rows, and failed ones. */
  launches: readonly LaunchView[];
  /** Launches Fleet now reports: launch id → the Session it became. */
  started: ReadonlyMap<string, string>;
  /**
   * Rows a snapshot dropped while the server's list wasn't known yet (it had just restarted).
   * They may come back under a new id (a Codex Session that got its session id), so they're
   * kept for matching until the list is known again.
   */
  orphans: readonly SessionRow[];
  /** This tab's event stream, named when it says what it views. */
  clientId: string | null;
  /** VIEW-2: the latest terminal preview per Session this tab previews. */
  previews: ReadonlyMap<string, Preview>;
  /** USAGE: the latest numbers, or null before the first read. */
  usage: UsageSnapshot | null;
}

export interface Preview {
  text: string | null;
  error: string | null;
}

export type Action = { type: 'event'; event: ServerEvent } | { type: 'connection'; connected: boolean };

export const initialState: LookoutState = {
  loaded: false,
  connected: false,
  sessions: new Map(),
  lastKnown: new Map(),
  aliases: new Map(),
  fleet: { state: 'starting' },
  settings: defaultSettings(),
  launches: [],
  started: new Map(),
  orphans: [],
  clientId: null,
  previews: new Map(),
  usage: null,
};

export function reducer(state: LookoutState, action: Action): LookoutState {
  if (action.type === 'connection') {
    return action.connected === state.connected ? state : { ...state, connected: action.connected };
  }
  const e = action.event;
  switch (e.type) {
    case 'snapshot': {
      const sessions = new Map(e.sessions.map((s) => [s.id, s]));
      const lastKnown = new Map(state.lastKnown);
      for (const s of e.sessions) lastKnown.set(s.id, s);
      // After a reconnect, rows may have changed identity while we weren't listening.
      const gone = [...state.orphans, ...state.sessions.values()].filter((s) => !sessions.has(s.id));
      const aliases = withSuccessors(state.aliases, gone, e.sessions);
      // A list that isn't known yet proves nothing: keep what it dropped for later matching.
      const orphans = listKnown({ loaded: true, fleet: e.fleet })
        ? []
        : gone.filter((g) => !e.sessions.some((s) => s.pid === g.pid && s.harness === g.harness));
      const started = new Map(state.started);
      for (const s of e.started) started.set(s.launchId, s.sessionId);
      return {
        ...state,
        loaded: true,
        connected: true,
        sessions,
        lastKnown,
        aliases,
        fleet: e.fleet,
        settings: e.settings,
        launches: e.launches,
        started,
        orphans,
        clientId: e.clientId,
        previews: new Map(), // a new stream: previews come again once it says what it views
        usage: e.usage ?? state.usage,
      };
    }
    case 'sessions': {
      const sessions = new Map(state.sessions);
      const lastKnown = new Map(state.lastKnown);
      const gone = e.remove.map((id) => sessions.get(id)).filter((s): s is SessionRow => !!s);
      for (const id of e.remove) sessions.delete(id);
      for (const s of e.upsert) {
        sessions.set(s.id, s);
        lastKnown.set(s.id, s);
      }
      const aliases = withSuccessors(state.aliases, [...gone, ...state.orphans], e.upsert);
      const orphans = state.orphans.filter((o) => !e.upsert.some((u) => u.pid === o.pid && u.harness === o.harness));
      return { ...state, sessions, lastKnown, aliases, orphans };
    }
    case 'fleet': {
      // Once the list is known again, orphans that didn't come back really ended.
      const known = listKnown({ loaded: state.loaded, fleet: e.fleet });
      return { ...state, fleet: e.fleet, orphans: known ? [] : state.orphans };
    }
    case 'settings':
      return { ...state, settings: e.settings };
    case 'usage':
      return { ...state, usage: e.usage };
    case 'preview':
      return { ...state, previews: new Map(state.previews).set(e.sessionId, { text: e.text, error: e.error }) };
    case 'launches': {
      let started = state.started;
      if (e.started.length) {
        const next = new Map(started);
        for (const s of e.started) next.set(s.launchId, s.sessionId);
        started = next;
      }
      return { ...state, launches: e.launches, started };
    }
  }
}

/** A gone row's successor is a new row of the same process (same pid and Harness). */
function withSuccessors(
  aliases: ReadonlyMap<string, string>,
  gone: readonly SessionRow[],
  incoming: readonly SessionRow[],
): ReadonlyMap<string, string> {
  let out = aliases;
  for (const g of gone) {
    const successor = incoming.find((u) => u.pid === g.pid && u.harness === g.harness && u.id !== g.id);
    if (successor) out = new Map(out).set(g.id, successor.id);
  }
  return out;
}

/**
 * Whether the server's list comes from a successful `fleet list`, so a Session missing from it
 * really ended. Not while the server's first poll is pending, nor when Fleet is missing or has
 * never answered.
 */
export function listKnown(state: Pick<LookoutState, 'loaded' | 'fleet'>): boolean {
  const { fleet } = state;
  return state.loaded && (fleet.state === 'ok' || (fleet.state === 'failing' && fleet.lastOkAt !== null));
}

export function useLookout(client: LookoutClient): LookoutState {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(
    () =>
      client.subscribe({
        onEvent: (event) => dispatch({ type: 'event', event }),
        onConnection: (connected) => dispatch({ type: 'connection', connected }),
      }),
    [client],
  );
  return state;
}
