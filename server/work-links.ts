import type { LinkedPr, LinkedTask, PrLinks, SessionLinkReason, WorkPr, WorkSessionLink, WorkTask } from '../shared/work.ts';
import type { Harness } from '../shared/types.ts';
import { SESSION_ID } from './history.ts';
import { sanitizeLine } from './sanitize.ts';

const MAX_TITLE = 300;
const OPENER_SLACK_MS = 5 * 60_000;

export interface LinkCandidate {
  sessionId: string;
  harness: Harness;
  title: string;
  firstPrompt: string;
  createdAt: number | null;
  modifiedAt: number | null;
}

export interface SessionSearchResult {
  sessions: LinkCandidate[];
  /** tb-session returned 200 rows; there may be more. */
  incomplete: boolean;
}

export interface WorkLinkSearches {
  prs: ReadonlyMap<string, SessionSearchResult>;
  tasks: ReadonlyMap<string, SessionSearchResult>;
}

export class TbSessionShapeError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex -- strip controls
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function candidate(value: unknown): LinkCandidate | null {
  if (!isObject(value) || typeof value.session_id !== 'string' || !SESSION_ID.test(value.session_id) || value.is_sidechain === true) return null;
  const harness = value.harness === undefined ? 'claude' : value.harness;
  if (harness !== 'claude' && harness !== 'codex') return null;
  if (typeof value.first_prompt !== 'string' || !value.first_prompt.trim()) return null;
  const firstPrompt = oneLine(value.first_prompt);
  const summary = sanitizeLine(value.summary, MAX_TITLE) ?? '';
  const promptTitle = sanitizeLine(firstPrompt, MAX_TITLE) ?? '';
  return {
    sessionId: value.session_id,
    harness,
    title: summary || promptTitle || `Untitled Session ${value.session_id.slice(0, 8)}`,
    firstPrompt,
    createdAt: timestamp(value.created_at),
    modifiedAt: timestamp(value.modified_at),
  };
}

/** Validates the stable portion of `tb-session search --json` and notices its 200 row limit. */
export function parseSessionSearch(stdout: string): SessionSearchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new TbSessionShapeError('search printed invalid JSON');
  }
  if (!isObject(parsed) || !Array.isArray(parsed.results)) throw new TbSessionShapeError('search printed no results list');
  const raw = parsed.results as unknown[];
  return { sessions: raw.map(candidate).filter((row): row is LinkCandidate => row !== null), incomplete: raw.length >= 200 };
}

const asciiLower = (value: string) => value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
const URL_CONTINUATION = /[A-Za-z0-9_-]/;

/** WORK-4.7: the URL is present only when its next character can't extend its last path component. */
export function containsWholeUrl(text: string, url: string): boolean {
  const haystack = asciiLower(text);
  const needle = asciiLower(url);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const next = text[at + needle.length];
    if (next === undefined || !URL_CONTINUATION.test(next)) return true;
    from = at + needle.length;
  }
}

/** WORK-4.3: only the Productive task URL forms from the spec count, and ids are ASCII digits. */
export function containsTaskUrl(text: string, id: string): boolean {
  if (!/^[0-9]+$/.test(id)) return false;
  const haystack = asciiLower(text);
  const path = /https:\/\/app\.(?:fantastic\.)?productive\.io\/109(?:-[a-z0-9-]+)?\/tasks\/(?:task\/)?([0-9]+)/g;
  for (const match of haystack.matchAll(path)) {
    const at = match.index! + match[0].length;
    const after = haystack[at];
    if (match[1] === id && (after === undefined || !URL_CONTINUATION.test(after))) return true;
  }

  // Fantastic's home route can put the Task in its query. Stop at punctuation that ends the URL,
  // so two pasted links separated by a comma are each considered on their own.
  const fantastic = /https:\/\/app\.fantastic\.productive\.io\/109(?:-[a-z0-9-]+)?\/[^\s?#),|<>"'\x5b\x5d]*\?([^\s#),|<>"'\x5b\x5d]*)/g;
  for (const match of haystack.matchAll(fantastic)) {
    const parameter = (match[1] ?? '').split('&').find((part) => part.split('=', 1)[0] === 'task');
    if (parameter === undefined) continue;
    const equals = parameter.indexOf('=');
    if (equals < 0) continue;
    const value = parameter.slice(equals + 1);
    if (value.startsWith(id) && (value[id.length] === undefined || !URL_CONTINUATION.test(value[id.length]!))) return true;
  }
  return false;
}

function hasLongerPullNumber(prompt: string, url: string): boolean {
  if (!/\/pull\/[0-9]+$/i.test(url)) return false;
  const haystack = asciiLower(prompt);
  const needle = asciiLower(url);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const next = prompt[at + needle.length];
    if (next !== undefined && /[0-9]/.test(next)) return true;
    from = at + needle.length;
  }
}

function link(candidate: LinkCandidate, reason: SessionLinkReason, live: ReadonlySet<string>): WorkSessionLink {
  return {
    sessionId: candidate.sessionId,
    harness: candidate.harness,
    title: candidate.title,
    createdAt: candidate.createdAt,
    modifiedAt: candidate.modifiedAt,
    live: live.has(candidate.sessionId),
    reason,
  };
}

function prSessions(pr: WorkPr, search: SessionSearchResult | undefined, live: ReadonlySet<string>): WorkSessionLink[] {
  if (!search) return [];
  const started: WorkSessionLink[] = [];
  const possibleOpeners: LinkCandidate[] = [];
  for (const row of search.sessions) {
    if (containsWholeUrl(row.firstPrompt, pr.url)) {
      started.push(link(row, 'started on this PR', live));
      continue;
    }
    if (hasLongerPullNumber(row.firstPrompt, pr.url)) continue;
    const createdAt = row.createdAt;
    const modifiedAt = row.modifiedAt;
    if (pr.createdAt === null || createdAt === null || modifiedAt === null) continue;
    if (modifiedAt < createdAt) continue;
    if (createdAt <= pr.createdAt + OPENER_SLACK_MS && modifiedAt >= pr.createdAt - OPENER_SLACK_MS) possibleOpeners.push(row);
  }
  if (!search.incomplete) {
    const opener = possibleOpeners.sort((a, b) => a.createdAt! - b.createdAt! || a.sessionId.localeCompare(b.sessionId))[0];
    if (opener) started.push(link(opener, 'probably opened this PR (the earliest Session that mentions it)', live));
  }
  return started;
}

function orderedSources(sources: readonly ('branch' | 'body')[]): ('branch' | 'body')[] {
  return [...new Set(sources)].sort((a, b) => (a === 'branch' ? -1 : 1) - (b === 'branch' ? -1 : 1));
}

/** Joins only the IDs and first prompts already supplied by tb-pr and tb-session (WORK-4). */
export function buildWorkLinks(
  prs: readonly WorkPr[],
  tasks: readonly WorkTask[],
  searches: WorkLinkSearches,
  liveSessions: ReadonlySet<string>,
): { prs: WorkPr[]; tasks: WorkTask[] } {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const linksByTask = new Map<string, Map<string, LinkedPr>>();
  const linkedPrs = prs.map((pr) => {
    const linkedTasks = new Map<string, LinkedTask>();
    for (const ref of pr.taskIds ?? []) {
      const task = taskById.get(ref.id);
      if (!task) continue;
      const existing = linkedTasks.get(task.id) ?? { id: task.id, title: task.title, sources: [] };
      existing.sources.push(ref.source);
      linkedTasks.set(task.id, existing);
      const byPr = linksByTask.get(task.id) ?? new Map<string, LinkedPr>();
      const linkedPr = byPr.get(pr.url) ?? { repo: pr.repo, number: pr.number, url: pr.url, chip: pr.chip, ci: pr.ci, sources: [] };
      linkedPr.sources.push(ref.source);
      byPr.set(pr.url, linkedPr);
      linksByTask.set(task.id, byPr);
    }
    const result = searches.prs.get(pr.url);
    const links: PrLinks = {
      tasks: [...linkedTasks.values()].map((entry) => ({ ...entry, sources: orderedSources(entry.sources) })),
      sessions: prSessions(pr, result, liveSessions),
      incomplete: result?.incomplete ?? false,
    };
    return { ...pr, links };
  });

  const prByUrl = new Map(linkedPrs.map((pr) => [pr.url, pr]));
  const linkedTasks = tasks.map((task) => {
    const directSearch = searches.tasks.get(task.id);
    const directSessions = (directSearch?.sessions ?? [])
      .filter((row) => containsTaskUrl(row.firstPrompt, task.id))
      .map((row) => link(row, 'started on this Task', liveSessions));
    const viaPr: WorkSessionLink[] = [];
    let incomplete = directSearch?.incomplete ?? false;
    for (const linkedPr of linksByTask.get(task.id)?.values() ?? []) {
      const sourcePr = prByUrl.get(linkedPr.url);
      if (!sourcePr) continue;
      if (sourcePr.links?.incomplete) incomplete = true;
      for (const session of sourcePr.links?.sessions ?? []) {
        viaPr.push({ ...session, reason: `through PR #${linkedPr.number}` });
      }
    }
    const prsForTask = [...(linksByTask.get(task.id)?.values() ?? [])].map((entry) => ({ ...entry, sources: orderedSources(entry.sources) }));
    return {
      ...task,
      links: { prs: prsForTask, sessions: [...directSessions, ...viaPr], incomplete },
    };
  });
  return { prs: linkedPrs, tasks: linkedTasks };
}
