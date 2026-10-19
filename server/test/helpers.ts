import type { ChatEntry, ChatEvent, ServerEvent, SessionRow } from '../../shared/types.ts';
import { AnswerLedger } from '../answerer.ts';
import { run } from '../exec.ts';
import { type FleetRow, fetchFleetList } from '../fleet.ts';
import { normalizeRows } from '../normalize.ts';
import { Viewer } from '../viewer.ts';

/**
 * A Viewer wired as the server wires it, against the `fleet` at `fleet` run with `env`: it knows
 * the Sessions in `list` (Fleet's `list --json` rows, normalized into `rows`), and every chat
 * event it sends a tab lands in `events`. The caller stops the Viewer.
 */
export function chatViewer(fleet: string, env: NodeJS.ProcessEnv, list: FleetRow[]): { viewer: Viewer; events: ChatEvent[]; rows: Map<string, SessionRow> } {
  const rows = new Map(normalizeRows(list, { git: () => null, statusSince: () => null }).map((r) => [r.id, r]));
  const events: ChatEvent[] = [];
  const viewer = new Viewer({
    runner: run,
    fleetBin: () => fleet,
    lookup: (id) => rows.get(id) ?? null,
    freshList: () => fetchFleetList((f, a, o) => run(f, a, { ...o, env }), fleet),
    sendTo: (_c, e: ServerEvent) => void (e.type === 'chat' && events.push(e)),
    ledger: new AnswerLedger(),
    env,
    intervalMs: 50,
  });
  return { viewer, events, rows };
}

/** The tab's view of the chat, built from the events the way the store does. */
export function replay(events: ChatEvent[]): { entries: ChatEntry[]; queue: ChatEntry[] } {
  let entries: ChatEntry[] = [];
  let queue: ChatEntry[] = [];
  for (const e of events) {
    if (e.op === 'reset') [entries, queue] = [e.entries, e.queue];
    if (e.op !== 'append') continue;
    const at = new Map(entries.map((x, i) => [x.cursor, i]));
    entries = [...entries];
    for (const u of e.updated) if (at.has(u.cursor)) entries[at.get(u.cursor)!] = u;
    entries.push(...e.entries.filter((x) => !at.has(x.cursor)));
    queue = e.queue;
  }
  return { entries, queue };
}
