import type { OutputItem, OutputType } from '@shared/library.ts';
import { File, FileCode, FileText, Globe, Image, Share2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { vscodeHref } from './files.ts';

/** LIB-2.2: an Output's type, as its row names it. */
export const TYPE_LABEL: Record<OutputType | 'artifact' | 'share', string> = { markdown: 'Markdown', html: 'HTML', pdf: 'PDF', image: 'Image', artifact: 'Artifact', share: 'Share' };
export const OUTPUT_ICON: Record<keyof typeof TYPE_LABEL, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = { markdown: FileText, html: FileCode, pdf: File, image: Image, artifact: Globe, share: Share2 };

/** LIB-3.3: Markdown in VS Code; anything else in a new browser tab, through Lookout's own file route. */
export function openFile(path: string, type: OutputType) {
  if (type === 'markdown') window.open(vscodeHref(path, null, null), '_self');
  else window.open(`/api/library/file?${new URLSearchParams({ path })}`, '_blank', 'noopener,noreferrer');
}
/** LIB-3.3: a file that's there, or an Artifact's or share's URL. */
export function openOutput(item: OutputItem) {
  if (item.kind === 'file') { if (item.exists && item.path && item.type) openFile(item.path, item.type); }
  else if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
}
