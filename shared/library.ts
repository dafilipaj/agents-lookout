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
}
export type LibraryPage =
  | { state: 'not-installed'; installCommand: string }
  /** TOOLS-2.5: tb-session answered as one without `events`: "tb-session 0.3.0 is older than the Library needs (0.4.0)". */
  | { state: 'too-old'; reason: string; installCommand: string }
  | { state: 'read-again' }
  | { state: 'ok'; items: OutputItem[]; readId: string; total: number; nextPage: number; hasMore: boolean; projects: string[]; hiddenGone: number; unfilteredEmpty: boolean };
