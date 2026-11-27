import { IN_LOOKOUT_TYPES, type LibraryType, type OutputItem, type OutputType, documentTypeOf } from '@shared/library.ts';
import { AppWindow, File, Hash, Image, Share2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { vscodeHref } from './files.ts';

/** LIB-2.2: an Output's type, as its row names it. */
export const TYPE_LABEL: Record<OutputType | 'artifact' | 'share', string> = { markdown: 'Markdown', html: 'HTML', pdf: 'PDF', image: 'Image', artifact: 'Artifact', share: 'Share' };
type TypeIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
/** LIB-2.2: each Type chip's icon, one outline per chip, so its rows can be told apart at a glance. */
export const CHIP_ICON: Record<LibraryType, TypeIcon> = { pages: AppWindow, pdf: File, markdown: Hash, image: Image, share: Share2 };
/** LIB-2.2: a row's icon is its chip's; an HTML file and an Artifact are both Pages. */
export const OUTPUT_ICON: Record<keyof typeof TYPE_LABEL, TypeIcon> = { markdown: CHIP_ICON.markdown, html: CHIP_ICON.pages, pdf: CHIP_ICON.pdf, image: CHIP_ICON.image, artifact: CHIP_ICON.pages, share: CHIP_ICON.share };

/** DOC-1.1: whether the Document view shows this Type. */
export const showsInLookout = (type: OutputType | null | undefined): boolean => !!type && IN_LOOKOUT_TYPES.includes(type);
/** DOC-1.4: whether a path names a file the Document view shows, by its extension. */
export const isDocumentPath = (path: string): boolean => showsInLookout(documentTypeOf(path));
/** DOC-1.2: the file an Output's Open shows in Lookout; null when Open leaves Lookout (a PDF, an Artifact, a Share) or has nothing to open. */
export const documentOf = (item: OutputItem): string | null => (item.kind === 'file' && item.exists && item.path && showsInLookout(item.type) ? item.path : null);
/** DOC-1.2: Open file on an Artifact's row: its source file, when the Document view shows it. */
export const sourceDocumentOf = (item: OutputItem): string | null => (item.source?.exists && showsInLookout(item.source.type) ? item.source.path : null);

/** PEOPLE-4.5: a note's link into Obsidian, by its absolute path: Obsidian finds the Vault that holds it. */
export const obsidianHref = (path: string): string => `obsidian://open?path=${encodeURIComponent(path)}`;
/**
 * DOC-2.5, INBOX-2.8: what Open is for a file, by where it goes: a Markdown file of the Vault to
 * Obsidian (PEOPLE-4.5), any other Markdown file to VS Code, anything else to a browser tab.
 */
export const openActionOf = (type: OutputType | null | undefined, vault = false): 'open-obsidian' | 'open-vscode' | 'open-external' => (type !== 'markdown' ? 'open-external' : vault ? 'open-obsidian' : 'open-vscode');
/** INBOX-2.8: Open for an Output: a file's by its Type and where it is, an Artifact's or a Share's its URL. */
export const openActionOfOutput = (item: Pick<OutputItem, 'kind' | 'type' | 'vault'>) => (item.kind === 'file' ? openActionOf(item.type, item.vault) : 'open-external');

/**
 * DOC-2.5, INBOX-2.8: leaving Lookout with a file: Markdown in VS Code, or in Obsidian when it is the
 * Vault's (PEOPLE-4.5); anything else in a new browser tab, through Lookout's own file route (LIB-3.3).
 */
export function openFile(path: string, type: OutputType, vault = false) {
  if (type === 'markdown') window.open(vault ? obsidianHref(path) : vscodeHref(path, null, null), '_self');
  else window.open(`/api/library/file?${new URLSearchParams({ path })}`, '_blank', 'noopener,noreferrer');
}
/**
 * INBOX-2.4, 2.9: the same file route for a Report shown in place, in an `iframe` or an `img`: with
 * `frame=1` its answer lets Lookout's own page frame it, under the sandbox the tab has (LIB-3.3).
 */
export const framedFileUrl = (path: string): string => `/api/library/file?${new URLSearchParams({ path, frame: '1' })}`;
/** INBOX-2.8: whether Open has something to open: a file that's there, or an Artifact's or Share's URL (LIB-3.3: a gone file has no Open). */
export const canOpenOutput = (item: OutputItem): boolean => (item.kind === 'file' ? item.exists && !!item.path && !!item.type : !!item.url);
/** INBOX-2.8, LIB-3.3: leaving Lookout with an Output: a file that's there (`openFile`), or an Artifact's or Share's URL. */
export function openOutput(item: OutputItem) {
  if (item.kind === 'file') { if (item.exists && item.path && item.type) openFile(item.path, item.type, item.vault); }
  else if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
}
