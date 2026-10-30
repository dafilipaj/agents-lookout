import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { SHORTCUT_GROUPS, type Shortcut, shortcutsIn } from '@/lib/shortcuts';

/** SIDE-7.4: a shortcut's keys as `Kbd`s, with "or" before its alternative keys. */
export function ShortcutKeys({ shortcut }: { shortcut: Pick<Shortcut, 'keys' | 'alt'> }) {
  const kbd = (k: string) => <Kbd key={k}>{k}</Kbd>;
  return (
    <span className="flex items-center justify-end gap-1">
      {shortcut.keys.map(kbd)}
      {shortcut.alt && <span className="px-0.5">or</span>}
      {shortcut.alt?.map(kbd)}
    </span>
  );
}

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** What had focus when it opened: it gets focus back on close (SIDE-7.5). */
  returnFocus: HTMLElement | null;
}

/**
 * SIDE-7.4, SIDE-7.5: every shortcut the app handles, grouped, over whatever is open. It is a
 * `Dialog`, so Esc and Close shut it and the page's own shortcuts stand down meanwhile (`lib/modal`).
 */
export function ShortcutsDialog({ open, onOpenChange, returnFocus }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl"
        onCloseAutoFocus={(e) => {
          if (!returnFocus?.isConnected) return;
          e.preventDefault();
          returnFocus.focus();
        }}
      >
        <div className="border-b border-border px-5 pt-4 pb-3">
          <DialogTitle className="text-title">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-meta">Letters and / do nothing while you type in a field or while a dialog is open.</DialogDescription>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.id} aria-label={group.title} data-group={group.id}>
              <h3 className="mb-1.5 text-body font-medium">{group.title}</h3>
              <ul className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1.5 text-meta">
                {shortcutsIn(group.id).map((s) => (
                  <li key={s.id} data-shortcut={s.id} className="contents">
                    <ShortcutKeys shortcut={s} />
                    <span className="leading-5">
                      {s.label}
                      {s.note && <span className="text-muted-foreground"> {s.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
