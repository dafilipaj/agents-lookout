import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CircleStop,
  Code,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  FileText,
  FolderInput,
  Forward,
  Gem,
  History,
  Layers,
  type LucideIcon,
  type LucideProps,
  Mail,
  Network,
  OctagonX,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  ScanEye,
  Sparkles,
  SquareTerminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
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
  /** PEOPLE-4.5: a note of the Vault, in the notes app where its links work. */
  'open-obsidian': { word: 'Open in Obsidian', icon: Gem },
  resume: { word: 'Resume', icon: History },
  show: { word: 'Show', icon: Eye },
  start: { word: 'Start Session', icon: Play },
  review: { word: 'Review', icon: ScanEye, key: 'R' },
  specs: { word: 'Specs', icon: FileText, key: 'S' },
  /** HAND-1.1: ask the Session for a Handover, for a new Session that continues its work. */
  'hand-off': { word: 'Hand off…', icon: Forward, key: 'F' },
  'add-to-topic': { word: 'Add to Topic', icon: Layers, key: 'A' },
  'link-to-topic': { word: 'Link to Topic…', icon: ArrowLeftRight },
  'open-graph': { word: 'Open graph', icon: Network, key: 'G' },
  copy: { word: 'Copy', icon: Copy },
  archive: { word: 'Archive', icon: Archive },
  unarchive: { word: 'Unarchive', icon: ArchiveRestore },
  /** INBOX-3.2: a Report made unread again, as a closed envelope is. */
  'mark-unread': { word: 'Mark unread', icon: Mail },
  delete: { word: 'Delete', icon: Trash2 },
  stop: { word: 'Stop', icon: CircleStop },
  esc: { word: 'Esc', icon: OctagonX },
  'end-session': { word: 'End Session', icon: Power },
  'show-terminal': { word: 'Show terminal', icon: SquareTerminal },
  /** BOT-1.3, BOT-1.5: a Bot made, changed in its dialog, and started by hand (BOT-4.2). */
  'new-bot': { word: 'New Bot', icon: Plus },
  edit: { word: 'Edit', icon: Pencil },
  'run-now': { word: 'Run now', icon: Play },
  /** SETUP-4: a Claude Code skill or plugin, for Sessions started from now on. BOT-2.5: a Bot's schedule. */
  'turn-off': { word: 'Turn off', icon: ToggleLeft },
  'turn-on': { word: 'Turn on', icon: ToggleRight },
  refresh: { word: 'Refresh', icon: RefreshCw },
  retry: { word: 'Retry', icon: RotateCw },
  suggest: { word: 'Suggest', icon: Sparkles },
  more: { word: 'More', icon: Ellipsis },
  /** TOPIC-9.4, TOPIC-14.5: a recommendation or a proposal, taken, moved or let go. */
  accept: { word: 'Accept', icon: Check },
  'other-topic': { word: 'Other Topic…', icon: FolderInput },
  dismiss: { word: 'Dismiss', icon: X },
} as const satisfies Record<string, { word: string; icon: LucideIcon; key?: string }>;

export type ActionId = keyof typeof ACTIONS;

/** An action's word. */
export const actionWord = (id: ActionId): string => ACTIONS[id].word;

/** An action's icon, at the size its place gives (a Button's or a menu's). */
export function ActionIcon({ id, ...props }: { id: ActionId } & LucideProps) {
  return createElement(ACTIONS[id].icon, { 'aria-hidden': true, ...props, ...({ 'data-action-icon': id } as LucideProps) });
}
