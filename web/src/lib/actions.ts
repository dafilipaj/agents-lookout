import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  ArrowRight,
  CircleStop,
  Code,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  FileText,
  History,
  Layers,
  type LucideIcon,
  type LucideProps,
  Network,
  OctagonX,
  Play,
  Power,
  RefreshCw,
  RotateCw,
  ScanEye,
  Sparkles,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { createElement } from 'react';

/**
 * DS-18.6: each action has one icon, in this one table, with its word and its key when it has the
 * same one everywhere. Opening something inside Lookout and leaving Lookout have different icons.
 * A row's first action and a menu item name their action, so their icon and word come from here;
 * a `Button` that runs one draws its icon with `ActionIcon` (the guard, DS-18.7, check 9).
 */
export const ACTIONS = {
  /** Inside Lookout: a live Session, a Topic view, the Spec view. */
  open: { word: 'Open', icon: ArrowRight },
  /** Leaving Lookout: GitHub, Fantastic, a file in its app, a URL. */
  'open-external': { word: 'Open', icon: ExternalLink },
  'open-vscode': { word: 'Open in VS Code', icon: Code },
  resume: { word: 'Resume', icon: History },
  show: { word: 'Show', icon: Eye },
  start: { word: 'Start Session', icon: Play },
  review: { word: 'Review', icon: ScanEye, key: 'R' },
  specs: { word: 'Specs', icon: FileText, key: 'S' },
  'add-to-topic': { word: 'Add to Topic', icon: Layers, key: 'A' },
  'link-to-topic': { word: 'Link to Topic…', icon: ArrowLeftRight },
  'open-graph': { word: 'Open graph', icon: Network, key: 'G' },
  copy: { word: 'Copy', icon: Copy },
  archive: { word: 'Archive', icon: Archive },
  unarchive: { word: 'Unarchive', icon: ArchiveRestore },
  delete: { word: 'Delete', icon: Trash2 },
  stop: { word: 'Stop', icon: CircleStop },
  esc: { word: 'Esc', icon: OctagonX },
  'end-session': { word: 'End Session', icon: Power },
  'show-terminal': { word: 'Show terminal', icon: SquareTerminal },
  refresh: { word: 'Refresh', icon: RefreshCw },
  retry: { word: 'Retry', icon: RotateCw },
  suggest: { word: 'Suggest', icon: Sparkles },
  more: { word: 'More', icon: Ellipsis },
} as const satisfies Record<string, { word: string; icon: LucideIcon; key?: string }>;

export type ActionId = keyof typeof ACTIONS;

/** An action's word. */
export const actionWord = (id: ActionId): string => ACTIONS[id].word;

/** An action's icon, at the size its place gives (a Button's or a menu's). */
export function ActionIcon({ id, ...props }: { id: ActionId } & LucideProps) {
  return createElement(ACTIONS[id].icon, { 'aria-hidden': true, ...props, ...({ 'data-action-icon': id } as LucideProps) });
}
