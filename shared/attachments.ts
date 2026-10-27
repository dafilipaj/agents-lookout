export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

/** VIEW-9.11: the server owns the basename; never accept a client destination. */
export function safeName(name: string, collision = 1): string {
  const base = (name.split(/[/\\]/).at(-1) ?? '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+/, '') || 'attachment';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  // Even an unusually long extension must leave room for a basename.
  const suffix = collision > 1 ? `-${collision}` : '';
  const ext = dot > 0 ? truncate(base.slice(dot), 120 - new TextEncoder().encode([...stem][0]!).length - suffix.length) : '';
  return truncate(stem, 120 - new TextEncoder().encode(ext).length - suffix.length) + suffix + ext;
}

function truncate(text: string, bytes: number): string {
  let out = '';
  for (const char of text) {
    bytes -= new TextEncoder().encode(char).length;
    if (bytes < 0) break;
    out += char;
  }
  return out;
}
