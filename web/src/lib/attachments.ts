import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@shared/attachments.ts';
import { SaveError, type LookoutClient } from './client';

export type AttachmentInput = { kind: 'path'; path: string } | { kind: 'file'; file: File; name: string; directory: boolean };

/** During dragover browsers expose types, but hide the URI list and file names. */
export const attachmentDrag = (data: DataTransfer) => Array.from(data.types).some(t => t === 'Files' || t === 'text/uri-list');

function files(data: DataTransfer): AttachmentInput[] {
  const items = Array.from(data.items ?? []).filter(item => item.kind === 'file');
  return Array.from(data.files).map((file, i) => ({ kind: 'file', file, name: file.name || 'attachment', directory: items[i]?.webkitGetAsEntry?.()?.isDirectory ?? false }));
}

const fileUris = (data: DataTransfer) => data.getData('text/uri-list').split(/\r?\n/).map(s => s.trim()).filter(s => /^file:/i.test(s));
export const carriesFileUri = (data: DataTransfer) => fileUris(data).length > 0;

export function fromDrop(data: DataTransfer): AttachmentInput[] {
  const uris = fileUris(data);
  if (!uris.length) return files(data);
  return uris.flatMap(uri => {
    try {
      // Require an absolute URI path before URL's parser can normalise a relative one.
      if (!/^file:\/\//i.test(uri)) return [];
      const url = new URL(uri);
      if (url.hostname !== '' && url.hostname !== 'localhost') return [];
      const path = decodeURIComponent(url.pathname);
      return path.startsWith('/') ? [{ kind: 'path' as const, path }] : [];
    } catch { return []; }
  });
}

export function fromPaste(data: DataTransfer, now = new Date()): AttachmentInput[] {
  if (Array.from(data.types).includes('text/plain')) return [];
  return files(data).map(input => {
    if (input.kind !== 'file' || !input.file.type.startsWith('image/') || (input.file.name && input.file.name !== 'image.png')) return input;
    const type = input.file.type.slice(6).split('+')[0]!;
    const ext = type === 'jpeg' ? 'jpg' : type.replace(/[^a-z0-9]/gi, '') || 'png';
    const clock = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('-');
    return { ...input, name: `pasted-${clock}.${ext}` };
  });
}

export function escapePath(path: string): string {
  if (/[\p{Cc}\u2028\u2029]/u.test(path)) throw new Error('A path with a line break or another control character cannot be typed into the Session.');
  if (!path.startsWith('/')) throw new Error('An attachment needs an absolute path.');
  return path.replace(/[^\p{L}\p{N}/._+@,:=~-]/gu, '\\$&');
}

export function insertion(text: string, start: number, end: number, paths: readonly string[]): { text: string; caret: number } {
  const before = text.slice(0, start);
  const inserted = (before && !/\s$/.test(before) ? ' ' : '') + paths.map(escapePath).join(' ') + ' ';
  return { text: before + inserted + text.slice(end), caret: start + inserted.length };
}

export interface AttachmentState { loading: string | null; error: string | null }
const EMPTY: AttachmentState = { loading: null, error: null };
type Insert = (paths: string[], append: boolean) => void;

/** App-owned uploads outlive the selected view; a mounted composer owns its native undo stack. */
export class ComposerAttachments {
  private states = new Map<string, AttachmentState>();
  private listeners = new Set<() => void>();
  private boxes = new Map<string, Insert>();
  private pending = new Map<string, number>();
  private attach: LookoutClient['attach'];
  private drafts: Map<string, string>;
  private live: (id: string) => boolean = () => false;
  private aliases: ReadonlyMap<string, string> = new Map();
  private listed: ReadonlySet<string> | ReadonlyMap<string, unknown> = new Set();
  constructor(attach: LookoutClient['attach'], drafts: Map<string, string>) { this.attach = attach; this.drafts = drafts; }
  setLive(lookup: (id: string) => boolean) { this.live = lookup; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  state = (id: string) => this.states.get(id) ?? EMPTY;
  private notify() { for (const listener of this.listeners) listener(); }
  private update(id: string, patch: Partial<AttachmentState>) {
    this.states.set(id, { ...this.state(id), ...patch });
    this.notify();
  }
  /** A Codex Session's current id, along the store's aliases (old id to new), as its drafts follow it; an id listed now (a reused pid) is its own. */
  private resolve(id: string): string {
    let cur = id;
    for (let k = 0; k < 8 && !this.listed.has(cur) && this.aliases.has(cur); k++) cur = this.aliases.get(cur)!;
    return cur;
  }
  /**
   * VIEW-9.9: a Session whose id changes mid-upload (a Codex Session getting its session id) keeps
   * its uploads: their count, line and error move to the new id, so its composer still blocks Send.
   */
  follow(aliases: ReadonlyMap<string, string>, listed: ReadonlyMap<string, unknown>) {
    this.aliases = aliases;
    this.listed = listed;
    let moved = false;
    for (const id of new Set([...this.states.keys(), ...this.pending.keys()])) {
      const to = this.resolve(id);
      if (to === id) continue;
      moved = true;
      const count = (this.pending.get(id) ?? 0) + (this.pending.get(to) ?? 0);
      this.pending.delete(id);
      if (count) this.pending.set(to, count);
      const from = this.states.get(id);
      this.states.delete(id);
      if (from) this.states.set(to, { loading: this.states.get(to)?.loading ?? from.loading, error: this.states.get(to)?.error ?? from.error });
    }
    if (moved) this.notify();
  }
  clear(id: string) { if (this.state(id).error) this.update(id, { error: null }); }
  bind(id: string, insert: Insert) { this.boxes.set(id, insert); return () => { if (this.boxes.get(id) === insert) this.boxes.delete(id); }; }

  async add(id: string, inputs: AttachmentInput[]): Promise<void> {
    this.clear(id);
    if (!inputs.length || !this.live(id)) return;
    if (inputs.length > MAX_ATTACHMENTS) { this.update(id, { error: `Drop at most 20 files at once; none of these ${inputs.length} were attached.` }); return; }
    const initialBox = this.boxes.get(id);
    const errors: string[] = [];
    const paths: (string | undefined)[] = new Array(inputs.length);
    const uploads = inputs.filter(i => i.kind === 'file' && !i.directory && i.file.size <= MAX_ATTACHMENT_BYTES);
    const count = uploads.length;
    const first = uploads[0];
    this.pending.set(id, (this.pending.get(id) ?? 0) + count);
    if (count) this.update(id, { loading: count === 1 && first?.kind === 'file' ? `Attaching ${first.name}…` : `Attaching ${count} files…` });
    let next = 0;
    const take = async () => {
      while (next < inputs.length) {
        const i = next++;
        const input = inputs[i]!;
        const name = input.kind === 'file' ? input.name : input.path;
        try {
          if (input.kind === 'file') {
            if (input.directory) throw new Error(`Lookout copies only files, so ${name} wasn't attached. Drag it from VS Code to insert its path.`);
            if (input.file.size > MAX_ATTACHMENT_BYTES) throw new Error(tooLarge(name, input.file.size));
            try { paths[i] = await this.attach(input.file, name); }
            catch (err) { throw new Error(uploadError(name, input.file.size, err), { cause: err }); }
          } else paths[i] = input.path;
          escapePath(paths[i]!);
        } catch (err) {
          paths[i] = undefined;
          const why = err instanceof Error ? err.message : 'Could not attach the file.';
          errors.push(why.includes(name) ? why : `${name}: ${why}`);
        }
      }
    };
    // A path-only drop stays synchronous, including focus and caret placement.
    const workers = Array.from({ length: Math.min(4, inputs.length) }, take);
    const finish = () => {
      // The Session may have a new id by now (`follow`); its uploads and draft are under that one.
      const target = this.resolve(id);
      const remaining = (this.pending.get(target) ?? count) - count;
      this.pending.set(target, remaining);
      const saved = paths.filter((path): path is string => path !== undefined);
      if (this.live(target) && saved.length) {
        const box = this.boxes.get(target);
        if (box) box(saved, box !== initialBox);
        else {
          // As App moves the selected Session's draft (VIEW-3.5): the old id's goes to the new one unless it has its own.
          const old = target === id ? undefined : this.drafts.get(id);
          if (old !== undefined && !this.drafts.has(target)) this.drafts.set(target, old);
          if (target !== id) this.drafts.delete(id);
          const draft = this.drafts.get(target) ?? '';
          this.drafts.set(target, insertion(draft, draft.length, draft.length, saved).text);
        }
      }
      this.update(target, { loading: remaining > 0 ? this.state(target).loading : null, error: errors.length ? errors.join(' ') : this.state(target).error });
    };
    if (count) await Promise.all(workers);
    finish();
  }
}

function tooLarge(name: string, bytes: number): string {
  return `${name} is ${Math.round(bytes / (1024 * 1024) * 10) / 10} MB, over the 25 MB Lookout copies. Drag it from VS Code to insert its path instead.`;
}
function uploadError(name: string, bytes: number, err: unknown): string {
  if (err instanceof SaveError && err.status === 413) return tooLarge(name, bytes);
  if (err instanceof SaveError && err.status === 507) return `The disk is full, so ${name} wasn't saved.`;
  if (err instanceof SaveError && err.lost) return `Lookout's server didn't answer, so ${name} wasn't attached.`;
  return `Lookout couldn't save ${name}.`;
}

export function textField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** VIEW-9.16: a rejected drop must never navigate away from Lookout. */
export function preventDropNavigation(event: DragEvent): void {
  const data = event.dataTransfer;
  if (event.defaultPrevented || !data) return;
  if (textField(event.target) && !attachmentDrag(data)) return;
  event.preventDefault(); data.dropEffect = 'none';
}
