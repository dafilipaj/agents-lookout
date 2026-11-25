import { commandWord } from '@shared/commands.ts';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type CommandsKey, type CommandsState, type ComposerCommands, type RankedCommand, commandsId, rankCommands } from '@/lib/commands';
import { insertText } from '@/lib/insert-text';

/**
 * A row's id in the listbox `id`, which the field's `aria-activedescendant` names (VIEW-15.11). It
 * is the item's, not the row's place: a screen reader says the highlighted row when that id changes,
 * and as you type the first row stays highlighted while the item in it changes.
 */
export const optionId = (id: string, call: string) => `${id}-option-${call}`;

/** VIEW-15.6: what the list says when the word leaves no row. */
export const NO_COMMAND_MATCHES = 'No command or skill matches';
/** VIEW-15.10: what the list says while it has nothing to show yet (DS-6.5). */
export const READING_COMMANDS = 'Reading commands and skills…';

const NO_STATE: CommandsState = { list: null, error: null, reading: false };
const noStore = () => () => {};

export interface CommandListOptions {
  /** The lists the tab has read; without it the field has no `/` list. */
  store: ComposerCommands | undefined;
  /** What the list is read for; null while there's nothing to read it for. */
  source: CommandsKey | null;
  /** The field's text now. */
  text: string;
  /** The field, to type a picked item into. */
  field: { current: HTMLTextAreaElement | null };
  /**
   * VIEW-15.8: in the composer, Enter on a row that already is the word, whole, is left to the
   * field, which sends it. The launcher's Enter always picks (LAUNCH-8.3).
   */
  enterSendsWhole: boolean;
}

export interface CommandListControl {
  open: boolean;
  /**
   * VIEW-15.11: what makes the field a combobox while the list is open; nothing otherwise. A message
   * box of several lines isn't a combobox the rest of the time, so the role comes with the list, as
   * GitHub's mention list does it.
   */
  field: { role?: 'combobox'; 'aria-expanded'?: true; 'aria-controls'?: string; 'aria-activedescendant'?: string; 'aria-autocomplete'?: 'list' };
  /** Call from the field's `onChange`: the list opens only as you type (VIEW-15.1). */
  typed(value: string): void;
  /** Call from the field's `onBlur`: focus leaving the field closes the list. */
  blurred(): void;
  /** Call first in the field's `onKeyDown`: true when the list took the key (VIEW-15.7). */
  keyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean;
  /** What the popover draws. */
  id: string;
  rows: readonly RankedCommand[];
  active: number;
  state: CommandsState;
  setActive(index: number): void;
  pick(index: number): void;
}

/**
 * VIEW-15.1, 15.7, 15.8: the `/` list of one field, the composer's or the launcher's prompt: when
 * it's open, which row is highlighted, and what the keys do. The field keeps focus throughout; this
 * only reads its text and types a picked item into it.
 */
export function useCommandList({ store, source, text, field, enterSendsWhole }: CommandListOptions): CommandListControl {
  const id = useId();
  // VIEW-15.1: the list works only on text you typed: what the field held after your last key. Text
  // that got there by itself (a draft, a taken-back message, a Topic's prompt) is never that, and a
  // field that changed by itself since stops being it.
  const [typedText, setTypedText] = useState<string | null>(null);
  if (typedText !== null && typedText !== text) setTypedText(null);
  // Esc closed it: it stays closed until the field is empty again, however it got empty (VIEW-15.7).
  const [dismissed, setDismissed] = useState(false);
  if (dismissed && text.trim() === '') setDismissed(false);
  const [active, setActive] = useState(0);
  const key = source ? commandsId(source) : null;
  const state = useSyncExternalStore(store?.subscribe ?? noStore, () => (store && key ? store.state(key) : NO_STATE));
  const word = commandWord(text);
  const open = store !== undefined && key !== null && typedText === text && !dismissed && word !== null;
  const typedWord = word?.word ?? null;
  const rows = useMemo(() => (open && state.list && typedWord !== null ? rankCommands(state.list.items, typedWord) : []), [open, state.list, typedWord]);

  // VIEW-15.7: a change to the word puts the highlight back on the first row.
  const [wordWas, setWordWas] = useState(typedWord);
  if (wordWas !== typedWord) {
    setWordWas(typedWord);
    setActive(0);
  }
  const at = Math.min(active, Math.max(0, rows.length - 1));

  // VIEW-15.10: opening reads the list, unless it was read a moment ago.
  const reads = useRef({ store, source });
  useEffect(() => {
    reads.current = { store, source };
  });
  useEffect(() => {
    const { store: s, source: k } = reads.current;
    if (open && s && k) s.open(k);
  }, [open, key]);

  const pick = (index: number) => {
    const row = rows[index];
    const box = field.current;
    if (!row || !box || !word) return;
    // VIEW-15.8: the item as it's called, in place of the word, with a space after it.
    box.focus();
    box.setSelectionRange(word.start, box.value.length);
    insertText(box, `${row.item.call} `);
  };

  return {
    open,
    field: open ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': id, 'aria-autocomplete': 'list', ...(rows[at] ? { 'aria-activedescendant': optionId(id, rows[at].item.call) } : {}) } : {},
    typed(value) {
      setTypedText(value);
    },
    blurred() {
      setTypedText(null);
    },
    keyDown(e) {
      if (!open || e.nativeEvent.isComposing) return false;
      const plain = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return true;
      }
      if (!rows.length || !plain) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))));
        return true;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (e.key === 'Enter' && enterSendsWhole && rows[at]!.item.call === typedWord) return false;
        e.preventDefault();
        pick(at);
        return true;
      }
      return false;
    },
    id,
    rows,
    active: at,
    state,
    setActive,
    pick,
  };
}
