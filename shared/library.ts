import type { HistoryItem } from './types.ts';

/** LIB slice 1: Lookout's rules over docs/contracts/tb-session-events.md. */
export type OutputType = 'markdown' | 'html' | 'pdf' | 'image';
export const LIBRARY_TYPES = ['pages', 'pdf', 'markdown', 'image', 'share'] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];
export const DEFAULT_LIBRARY_TYPES: LibraryType[] = ['pages', 'pdf'];
export interface LibraryFilter {
  types: LibraryType[];
  project: string;
  hideGone: boolean;
}
export interface LibraryQuery extends LibraryFilter {
  query: string;
  page: number;
  /** The complete server-held read used for paging and local filters. */
  readId?: string;
  headless: boolean;
  /** TOPIC-4.4: only Outputs these Sessions touched, as `<harness>:<sessionId>`; absent for all. */
  sessions?: string[];
}
export interface OutputSource {
  path: string;
  display: string;
  type: OutputType;
  createdAt: number;
  updatedAt: number;
  events: number;
  exists: boolean;
}
export interface OutputSession extends HistoryItem {
  event: 'write' | 'edit' | 'publish' | 'upload';
  pruned: boolean;
}
export interface OutputItem {
  kind: 'file' | 'artifact' | 'share';
  key: string;
  type: OutputType | null;
  title: string;
  path: string | null;
  url: string | null;
  display: string;
  projectPath: string | null;
  repo: string | null;
  createdAt: number;
  updatedAt: number;
  events: number;
  exists: boolean;
  source: OutputSource | null;
  sourcePath: string | null;
  sourceDisplay: string | null;
  version: number | null;
  sessions: OutputSession[];
  /** PEOPLE-4.5: a Markdown file under the Vault folder, which Open takes to Obsidian; absent for any other. */
  vault?: boolean;
}
export type LibraryPage =
  | { state: 'not-installed'; installCommand: string }
  /** TOOLS-2.5: tb-session answered as one without `events`: "tb-session 0.3.0 is older than the Library needs (0.4.0)". */
  | { state: 'too-old'; reason: string; installCommand: string }
  | { state: 'read-again' }
  | { state: 'ok'; items: OutputItem[]; readId: string; total: number; nextPage: number; hasMore: boolean; projects: string[]; hiddenGone: number; unfilteredEmpty: boolean };

/** LIB-2.10, EVID-7.1: the document Types by extension, lower case. */
export const DOCUMENT_TYPES: Readonly<Record<string, OutputType>> = { md: 'markdown', html: 'html', htm: 'html', pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image' };
/** LIB-2.10: a path's document Type by its file name's extension, case-insensitively; null when it isn't one (a dotfile has none). */
export function documentTypeOf(path: string): OutputType | null {
  const name = path.slice(path.lastIndexOf('/') + 1), dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return Object.hasOwn(DOCUMENT_TYPES, ext) ? DOCUMENT_TYPES[ext]! : null;
}
/** DOC-1.1: the Types the Document view shows. A PDF needs a browser tab: the frame's sandbox can't show one. */
export const IN_LOOKOUT_TYPES: readonly OutputType[] = ['markdown', 'html', 'image'];

/** DOC-3.1: what the server says of a file the Document view asks for: its Type, and whether it still exists. */
export interface DocumentAnswer {
  path: string;
  /** The path with the home directory as `~`, as the Library shows one (LIB-2.2). */
  display: string;
  type: OutputType;
  exists: boolean;
  /** PEOPLE-4.5: the file is under the Vault folder, so a Markdown one opens in Obsidian. */
  vault: boolean;
}
/** DOC-3.1: what the server answers for a path it won't read. */
export const DOCUMENT_UNAVAILABLE = "Lookout can't show this file.";
/** DOC-3.4: a file kept in the cloud that macOS wouldn't fetch for Lookout's server. */
export const FILE_NOT_DOWNLOADED = "This file is kept in iCloud and isn't on this Mac, and macOS wouldn't fetch it for Lookout's server. Open it once in your notes app, or download it in Finder, and it shows here.";
/** DOC-3.4: a file whose text hasn't arrived in time. */
export const FILE_SLOW = "This file hasn't arrived yet. One kept in iCloud is fetched over the network; open it again in a moment.";
/** DOC-3.4: a file that is one Lookout shows and whose read failed, with what the disk said; `cloud`: it isn't on this Mac, so the fetch failed. */
export const fileUnreadable = (code: string, cloud: boolean): string => {
  const said = code ? ` (${code})` : '';
  return cloud ? `This file is kept in iCloud and couldn't be fetched${said}. It needs the network; open it again when it's there.` : `This file couldn't be read${said}.`;
};
