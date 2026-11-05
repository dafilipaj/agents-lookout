import { Ellipsis } from 'lucide-react';
import { type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RowAction, RowSettling, labelledButtonLook, type RowActionProps } from '@/components/ui/icon-button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/** DS-16.2: the menu's groups, in their order; a divider goes before `manage`. */
export type RowMenuGroup = 'run' | 'open' | 'topic' | 'manage';
const GROUPS: readonly RowMenuGroup[] = ['run', 'open', 'topic', 'manage'];

/** DS-16.2: one of a row's actions under "More". */
export interface RowMenuItem {
  /** Its `data-action`. */
  id: string;
  label: string;
  icon: ReactNode;
  group: RowMenuGroup;
  /** Its panel's key, shown at the right (no new keys: only one the panel already has). */
  shortcut?: string;
  /** Delete: drawn in `destructive-text`. */
  destructive?: boolean;
  /** False while it can't act (a resume under way): it says so and does nothing. */
  enabled?: boolean;
  onSelect?(): void;
  /** A submenu instead of an action (PLAIN-5.1's Specs), with its open state when the panel holds it. */
  submenu?: { content: ReactNode; label: string; open?: boolean; onOpenChange?(open: boolean): void };
}

/** DS-16.1: the row's first action, the one Enter runs, as a labelled button. */
export type RowPrimary = Omit<RowActionProps, 'trailing'> & { 'data-action'?: string };

export interface RowActionsProps {
  primary: RowPrimary | null;
  /** The other actions; `null` and `false` are left out, so a row can list them conditionally. */
  more: readonly (RowMenuItem | null | false | undefined)[];
  /** The row's name, for the menu's accessible name ("More for <name>"). */
  name: string;
  /** The menu's open state, when the panel holds it (Work's `S` opens it with Specs open). */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /**
   * In a list whose rows aren't listbox options (the Topics tab, TOPIC-3.4): the buttons are in the
   * Tab order, Enter and Space press them, and closing the menu gives focus back to More.
   */
  focusable?: boolean;
  className?: string;
}

/**
 * DS-16: an expanded row's actions. The first, what Enter on the row runs, is a labelled button with
 * `↵`; the rest are under "More", grouped (DS-16.2), each with its key. It takes no children, so a row
 * can't add a second labelled button (DS-16.4). One line that never wraps: the first one's word is cut
 * short before it would. DS-7.4's spacing: 12 px above, 4 px below, 8 px between.
 */
export function RowActions({ primary, more, name, open, onOpenChange, focusable = false, className }: RowActionsProps) {
  const settling = useContext(RowSettling);
  const at = useRef<HTMLSpanElement>(null);
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  /** Where focus goes before an item acts and after the menu closes: the panel's list, else More. */
  const home = () => at.current?.closest<HTMLElement>('[role="listbox"]') ?? (focusable ? at.current : null);
  const items = GROUPS.flatMap((g) => more.filter((i): i is RowMenuItem => !!i && i.group === g));
  const press = (e: { key: string; preventDefault(): void; stopPropagation(): void }, run: () => void) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  return (
    <div data-field="actions" className={cn('mt-1.5 mb-1 flex min-w-0 flex-nowrap items-center gap-2', className)}>
      {primary && (
        <RowAction
          {...primary}
          {...(focusable && { tabIndex: 0, onKeyDown: (e) => press(e, () => primary.enabled !== false && primary.onPress()) })}
          trailing={<Kbd aria-hidden className="ml-0.5 text-muted-foreground">↵</Kbd>}
          className={cn('min-w-0 shrink', primary.className)}
        />
      )}
      {items.length > 0 && (
        <DropdownMenu modal={false} open={isOpen} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <span
              ref={at}
              role="button"
              tabIndex={focusable ? 0 : undefined}
              data-action="more"
              data-slot="row-action"
              title="More"
              aria-disabled={settling ? true : undefined}
              // DS-16.3: it opens and closes on a click, as RowAction acts, not on the press: a click with no
              // count (assistive technology's) works, and a double click's second click, or any while the
              // row settles, does nothing.
              onPointerDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                if (!settling && e.detail <= 1) setOpen(!isOpen);
              }}
              className={cn(labelledButtonLook(), 'cursor-pointer')}
            >
              <Ellipsis />
              <span>More</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-52 [&_svg:not([class*='size-'])]:size-4"
            aria-label={`More for ${name}`}
            // Named for its row, not after "More", which labels it otherwise.
            aria-labelledby={undefined}
            data-slot="row-menu"
            // More's own click closes it, so a press on More isn't one outside that closes it first.
            onPointerDownOutside={(e) => {
              if (e.target instanceof Node && at.current?.contains(e.target)) e.preventDefault();
            }}
            // DS-16.3: its clicks and keys are its own, never the row's under it (WORK-1.12).
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onCloseAutoFocus={(e) => {
              // Focus goes back to the panel's list (or More), unless it went to another control.
              e.preventDefault();
              const now = document.activeElement;
              if (!now || now === document.body || !now.isConnected || !!now.closest('[data-slot="row-menu"], [data-slot="row-submenu"]')) home()?.focus();
            }}
          >
            {items.map((item, n) => (
              <Item key={item.id} item={item} divider={item.group === 'manage' && n > 0 && items[n - 1]!.group !== 'manage'} onRun={() => home()?.focus()} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** `onRun` before an item acts: focus back on the panel's list, so a dialog the item opens gives it back there. */
function Item({ item, divider, onRun }: { item: RowMenuItem; divider: boolean; onRun(): void }) {
  const sub = useRef<HTMLDivElement>(null);
  const subOpen = !!item.submenu?.open;
  // A submenu the panel opened with the menu (S on a PR) takes focus once the menu has taken it, so
  // ↑ and ↓ move through it; one opened from its item keeps focus where the pointer or keys put it.
  useEffect(() => {
    if (!subOpen) return;
    const timer = setTimeout(() => {
      if (document.activeElement?.getAttribute('data-slot') === 'row-menu') sub.current?.focus();
    });
    return () => clearTimeout(timer);
  }, [subOpen]);
  const body = (
    <>
      {item.icon}
      <span className="min-w-0 truncate">{item.label}</span>
      {item.shortcut && <Kbd className="ml-auto text-muted-foreground">{item.shortcut}</Kbd>}
    </>
  );
  const tone = item.destructive ? 'text-destructive-text focus:text-destructive-text' : undefined;
  return (
    <>
      {divider && <DropdownMenuSeparator />}
      {item.submenu ? (
        <DropdownMenuSub open={item.submenu.open} onOpenChange={item.submenu.onOpenChange}>
          <DropdownMenuSubTrigger data-action={item.id} disabled={item.enabled === false} className={cn('gap-2', tone)}>
            {body}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            ref={sub}
            className="max-h-[60vh] w-[min(28rem,calc(100vw-2rem))]"
            aria-label={item.submenu.label}
            aria-labelledby={undefined}
            data-slot="row-submenu"
            // Focus moving to the menu around it (its first focus, after S) doesn't close it; ←, Esc, a click
            // outside or focus on another item does.
            onFocusOutside={(e) => {
              if (e.target instanceof Element && e.target.getAttribute('data-slot') === 'row-menu') e.preventDefault();
            }}
          >
            {item.submenu.content}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <DropdownMenuItem data-action={item.id} disabled={item.enabled === false} className={tone} onSelect={() => {
            onRun();
            item.onSelect?.();
          }}>
          {body}
        </DropdownMenuItem>
      )}
    </>
  );
}
