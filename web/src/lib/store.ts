import { type Settings, defaultSettings } from '@shared/settings.ts';
import type { ChatPage, FleetHealth, LaunchView, ServerEvent, SessionRow } from '@shared/types.ts';
import type { UsageSnapshot } from '@shared/usage.ts';
import type { WorkSnapshot } from '@shared/work.ts';
import { type Dispatch, useEffect, useReducer } from 'react';
import type { ScreenState } from './answers.ts';
import { CACHED_CHATS, type Chat, applyChatEvent, applyPage, emptyChat, park, setFollowing } from './chat.ts';
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
   * LAUNCH-4.2: starts this tab asked for that the server hasn't listed yet, so their row and view
   * show the moment you press Start. `answered`: the request is done; the next list settles it.
   */
  requested: ReadonlyMap<string, { launch: LaunchView; answered: boolean }>;
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
  /**
   * VIEW-4.2: the prompt on the viewed Session's terminal, as the server last read it. Cleared when
   * the tab views another Session: the server sends it again on viewing, so it's never stale.
   */
  prompts: ReadonlyMap<string, ScreenState>;
  /** USAGE: the latest numbers, or null before the first read. */
  usage: UsageSnapshot | null;
  /** WORK: the latest PRs and Refresh state, or null before the server sent any. */
  work: WorkSnapshot | null;
  /**
   * VIEW-1: the chat of the Session in view, plus a few recently viewed ones (cut to their latest
   * entries) for switching back. Kept across reconnects, and after the Session ends.
   */
  chats: ReadonlyMap<string, Chat>;
  /** The Session whose chat is in view, then the cached ones, most recent first. */
  chatOrder: readonly string[];
  /** The Session in view (chat updates for any other are ignored). */
  chatViewing: string | null;
}

export type { Chat } from './chat.ts';

export interface Preview {
  text: string | null;
  error: string | null;
}

export type Action =
  /** `at`: when the tab got it (its clock); VIEW-4.7 times reads that say nothing from it. */
  | { type: 'event'; event: ServerEvent; at?: number }
  | { type: 'connection'; connected: boolean }
  /** VIEW-1: the tab now views this Session's chat. */
  | { type: 'chat-view'; sessionId: string | null }
  /** VIEW-1.6: a "Show earlier" page, asked for with `before` while the chat had `epoch`. */
  | { type: 'chat-page'; sessionId: string; before: string; epoch: number; page: ChatPage }
  /** VIEW-1.5: whether you're at the bottom of the chat. */
  | { type: 'chat-following'; sessionId: string; following: boolean }
  /** LAUNCH-4.2: this tab asks for a start (or a resume) with its own launch id. */
  | { type: 'launch-requested'; launch: LaunchView }
  /**
   * The request for `id` answered with `launch` (null: it failed, or a resume found the Session
   * live). The answer stands in for the row until the server's next list settles it, but only
   * while the request's row is still this tab's own: once the server has listed it, its list is the
   * truth, so a late answer can't bring back a start that was dismissed meanwhile.
   */
  | { type: 'launch-answered'; id: string; launch: LaunchView | null };

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
  requested: new Map(),
  orphans: [],
  clientId: null,
  previews: new Map(),
  prompts: new Map(),
  usage: null,
  work: null,
  chats: new Map(),
  chatOrder: [],
  chatViewing: null,
};

export function reducer(state: LookoutState, action: Action): LookoutState {
  if (action.type === 'chat-view') return viewChat(state, action.sessionId);
  if (action.type === 'chat-page' || action.type === 'chat-following') {
    const chat = state.chats.get(action.sessionId);
    if (!chat) return state;
    const next =
      action.type === 'chat-page' ? applyPage(chat, action.before, action.epoch, action.page) : setFollowing(chat, action.following);
    return next === chat ? state : { ...state, chats: new Map(state.chats).set(action.sessionId, next) };
  }
  if (action.type === 'launch-requested') {
    return { ...state, requested: new Map(state.requested).set(action.launch.id, { launch: action.launch, answered: false }) };
  }
  if (action.type === 'launch-answered') {
    if (!state.requested.has(action.id)) return state;
    const requested = new Map(state.requested);
    requested.delete(action.id);
    const served = action.launch;
    // A resume already under way answers with its own launch; an older server picks its own id.
    if (served && !state.started.has(served.id) && !state.launches.some((l) => l.id === served.id)) {
      requested.set(served.id, { launch: served, answered: true });
    }
    return { ...state, requested };
  }
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
        requested: settleRequested(state.requested, e.launches, started),
        orphans,
        clientId: e.clientId,
        previews: new Map(), // a new stream: previews come again once it says what it views
        prompts: new Map(),
        usage: e.usage ?? state.usage,
        work: e.work ?? state.work,
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
    case 'work':
      return { ...state, work: e.work };
    case 'chat': {
      if (e.sessionId !== state.chatViewing) return state; // a late update for a Session left behind
      const chat = state.chats.get(e.sessionId) ?? emptyChat;
      const next = applyChatEvent(chat, e);
      return next === chat ? state : { ...state, chats: new Map(state.chats).set(e.sessionId, next) };
    }
    case 'preview':
      return { ...state, previews: new Map(state.previews).set(e.sessionId, { text: e.text, error: e.error }) };
    case 'prompt': {
      // VIEW-4.7: a read that says nothing of whether it can be answered (it failed) is timed from
      // the first of its run, so one slow read is waited out rather than said. After a read that
      // said why not, the run keeps that read's reason (`carried`) instead of going quiet, which
      // would hide the line and Esc and bring the form back, or swap the line out and back.
      const says = e.answerable === true || (e.detail ?? null) !== null || e.oldFleet === true;
      const since = e.since ?? null;
      const before = state.prompts.get(e.sessionId);
      const spell = before !== undefined && before.since === since ? before : undefined;
      const unread = says ? null : (spell?.unread ?? action.at ?? null);
      const kept = !says && spell !== undefined && spell.answerable !== true && (spell.detail != null || spell.oldFleet === true) ? spell : undefined;
      return {
        ...state,
        prompts: new Map(state.prompts).set(e.sessionId, {
          prompt: e.prompt,
          epoch: e.epoch,
          uncertain: e.uncertain ?? null,
          since,
          answerable: e.answerable === true,
          detail: kept ? (kept.detail ?? null) : (e.detail ?? null),
          pane: kept ? (kept.pane ?? null) : (e.pane ?? null),
          oldFleet: kept ? kept.oldFleet === true : e.oldFleet === true,
          unread,
          carried: kept !== undefined,
        }),
      };
    }
    case 'launches': {
      let started = state.started;
      if (e.started.length) {
        const next = new Map(started);
        for (const s of e.started) next.set(s.launchId, s.sessionId);
        started = next;
      }
      return { ...state, launches: e.launches, started, requested: settleRequested(state.requested, e.launches, started) };
    }
  }
}

/** VIEW-1: the chat in view changes; older ones are cut to their latest entries, the oldest dropped. */
function viewChat(state: LookoutState, sessionId: string | null): LookoutState {
  if (sessionId === state.chatViewing) return state;
  const order = sessionId ? [sessionId, ...state.chatOrder.filter((id) => id !== sessionId)] : [...state.chatOrder];
  const keep = order.slice(0, CACHED_CHATS + (sessionId ? 1 : 0));
  const chats = new Map<string, Chat>();
  for (const id of keep) {
    const chat = state.chats.get(id);
    if (chat) chats.set(id, id === sessionId ? chat : park(chat));
  }
  // VIEW-4.2: a prompt read for a Session left behind may be stale by the time it's viewed again.
  return { ...state, chats, chatOrder: keep, chatViewing: sessionId, prompts: new Map() };
}

/**
 * A full list of launches from the server settles this tab's requests: one it lists or reports
 * started is the server's now, and one whose request answered but that it doesn't list is gone.
 * One still under way stays (a resume reads tb-session and Fleet before its row appears).
 */
function settleRequested(
  requested: LookoutState['requested'],
  launches: readonly LaunchView[],
  started: ReadonlyMap<string, string>,
): LookoutState['requested'] {
  if (requested.size === 0) return requested;
  const listed = new Set(launches.map((l) => l.id));
  const next = new Map([...requested].filter(([id, r]) => !r.answered && !listed.has(id) && !started.has(id)));
  return next.size === requested.size ? requested : next;
}

/** Every launch to show: the server's, then this tab's own it doesn't list yet (LAUNCH-4.2). */
export function shownLaunches(state: Pick<LookoutState, 'launches' | 'requested'>): readonly LaunchView[] {
  if (state.requested.size === 0) return state.launches;
  const listed = new Set(state.launches.map((l) => l.id));
  const own = [...state.requested.values()].map((r) => r.launch).filter((l) => !listed.has(l.id));
  return own.length ? [...state.launches, ...own] : state.launches;
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

export function useLookout(client: LookoutClient): [LookoutState, Dispatch<Action>] {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(
    () =>
      client.subscribe({
        onEvent: (event) => dispatch({ type: 'event', event, at: Date.now() }),
        onConnection: (connected) => dispatch({ type: 'connection', connected }),
      }),
    [client],
  );
  return [state, dispatch];
}
