import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { MenuOptions } from '@/lib/status-switch';
import { cn } from '@/lib/utils';

export interface StatusMenuProps {
  /** The status-line part it is (`model`, `effort`): its `data-field`. */
  field: string;
  /** What it switches, for its name and tooltip (`Model`, `Effort`). */
  name: string;
  /** The value shown in the line. */
  value: string;
  /** Muted, after the value (VIEW-6.7's "from the next reply"); null for none. */
  note: string | null;
  /** In the tooltip, after the value, when it differs from `note` (VIEW-7.7: the line's one note sits on another part). */
  tipNote?: string | null;
  /** Why it can't be switched now (its tooltip); null when it can. */
  why: string | null;
  switching: boolean;
  options: MenuOptions;
  /** The choice the Session is on; null when none of them is. */
  checked: string | null;
  /** One muted line under the choices (VIEW-6.4). */
  footnote: string | null;
  /** Why the last switch failed, beside the value. */
  error: string | null;
  /** The menu opened: its choices may be read again. */
  onOpen(): void;
  onPick(value: string): void;
}

/**
 * VIEW-6, VIEW-7: a part of the status line that is also a menu: a ghost button the size of the line's
 * text, with a chevron, opening upward over the line. One radio item per choice (its label, the
 * detail dimmed), the current one checked. It works from the keyboard as Radix's menu does (VIEW-6.9):
 * Enter or Space opens it, the arrows move, Enter picks, Esc closes it and gives focus back.
 * While it can't be switched it stays focusable (`aria-disabled`) so its tooltip says why; an open
 * menu closes once that happens. While a switch runs it reads "Switching…".
 */
export function StatusMenu({ field, name, value, note, tipNote = note, why, switching, options, checked, footnote, error, onOpen, onPick }: StatusMenuProps) {
  const [open, setOpen] = useState(false);
  const blocked = switching || why !== null;
  // The Session stopped qualifying (or a switch began): the menu goes.
  if (open && blocked) setOpen(false);
  const shown = switching ? 'Switching…' : value;
  const tip = why ?? `${name}: ${value}${tipNote ? ` (${tipNote})` : ''}`;
  return (
    <>
      <DropdownMenu
        modal={false}
        open={open && !blocked}
        onOpenChange={(next) => {
          if (next && blocked) return;
          setOpen(next);
          if (next) onOpen();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-slot={`${field}-menu`}
            aria-label={`${name}: ${shown}`}
            aria-disabled={blocked || undefined}
            title={error ? `${tip}\n${error}` : tip}
            className={cn(
              'flex min-w-0 items-center gap-0.5 rounded-sm px-1 -mx-1 font-mono text-meta outline-none focus-visible:ring-2 focus-visible:ring-ring',
              blocked ? 'cursor-default opacity-70' : 'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            )}
          >
            <span className="min-w-0 truncate" data-field={field}>
              {shown}
            </span>
            <ChevronDown aria-hidden className="size-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-56">
          {options.state === 'loading' && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
          {options.state === 'error' && <DropdownMenuItem disabled>{options.error}</DropdownMenuItem>}
          {options.state === 'ready' && (
            <DropdownMenuRadioGroup
              value={checked ?? ''}
              onValueChange={(v) => {
                if (v !== checked) onPick(v);
              }}
            >
              {options.items.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  <span>{item.label}</span>
                  {item.detail && <span className="ml-auto pl-3 font-mono text-caption text-muted-foreground">{item.detail}</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
          {footnote && (
            <>
              <DropdownMenuSeparator />
              <p data-slot={`${field}-footnote`} className="px-2 py-1 text-meta text-muted-foreground">
                {footnote}
              </p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {note && !switching && (
        // VIEW-5.5: it truncates like the line's other parts, shrinking half as fast as the value.
        <span className="min-w-0 shrink-[0.5] truncate opacity-70" data-slot={`${field}-note`} title={note}>
          · {note}
        </span>
      )}
      {error && (
        <span role="alert" data-slot={`${field}-error`} title={error} className="min-w-0 truncate text-destructive-text">
          {error}
        </span>
      )}
    </>
  );
}
