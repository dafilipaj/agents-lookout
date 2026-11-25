/**
 * Types `text` over a field's selection as one native edit, so the field's own undo history keeps
 * it. jsdom has no `execCommand`: there the range is set and the input event sent by hand.
 */
export function insertText(box: HTMLTextAreaElement | null, text: string): void {
  if (!box || !text) return;
  box.focus();
  if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return;
  box.setRangeText(text, box.selectionStart, box.selectionEnd, 'end');
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
