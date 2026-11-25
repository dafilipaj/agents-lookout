import type { ReactElement } from 'react';
import { Alert } from '@/components/ui/alert';
import { CommandList } from '@/components/ui/command-list';
import { Loading } from '@/components/ui/loading';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { type CommandListControl, NO_COMMAND_MATCHES, READING_COMMANDS } from '@/lib/command-list';

interface CommandsPopoverProps {
  control: CommandListControl;
  /** The composer's opens upward over the chat; the launcher's downward, under its prompt. */
  side: 'top' | 'bottom';
  /** What the list hangs from, and is as wide as: the composer's box, the launcher's field. */
  children: ReactElement;
}

/**
 * VIEW UX, "The `/` list": the list in a popover anchored to the field's box. It never takes focus,
 * whatever in it is pressed, and takes no room in the layout.
 *
 * The field alone opens and closes it (`useCommandList`): its own Esc, and focus leaving it. Radix
 * would close it too, on an Esc and on a press or a focus outside, and it hears the key before the
 * field does: the list would be closed by the time the field's own Esc handler ran, and the composer
 * would take that one Esc as the next and leave (VIEW-15.7). So Radix is told to leave both be.
 */
export function CommandsPopover({ control, side, children }: CommandsPopoverProps) {
  const { state, rows } = control;
  const note = state.reading && !state.list ? <Loading label={READING_COMMANDS} /> : state.error ? <Alert layout="inline" title={state.error} /> : null;
  return (
    <Popover open={control.open}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={4}
        data-slot="commands-popover"
        // A popover is a dialog by default; this one only holds the field's listbox (VIEW-15.11).
        role={undefined}
        // Closed, it leaves at once: while it faded it would still be the layer an Esc goes to, so a
        // quick second Esc wouldn't reach the launcher under it (LAUNCH-8.3).
        className="w-(--radix-popover-trigger-width) max-w-none p-0 data-[state=closed]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // A press anywhere in it must not take focus from the field (VIEW-15.7): not on a row, and not
        // beside one either (its edge, a gap, what it says in place of its rows). Radix makes this
        // content focusable, so such a press would move focus here, close the list, and leave focus
        // on the page, where the next keys are the app's shortcuts.
        onMouseDown={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <CommandList id={control.id} rows={rows} active={control.active} onActive={control.setActive} onPick={control.pick} note={note} empty={state.list && !rows.length ? NO_COMMAND_MATCHES : null} />
      </PopoverContent>
    </Popover>
  );
}
