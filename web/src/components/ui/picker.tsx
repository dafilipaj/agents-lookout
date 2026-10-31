import { Search } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { cn } from '@/lib/utils';

export interface PickerItem {
  id: string;
  label: string;
  /** Muted, after the label: what it holds, or that the item is already in it. */
  hint?: ReactNode;
}

export interface PickerListProps {
  /** The filter's name and placeholder. */
  filterLabel: string;
  items: readonly PickerItem[];
  /** Matched against each item's label, ignoring case; items it never hides (a "New…" entry) pass `keep`. */
  keep?: (item: PickerItem) => boolean;
  onPick(id: string): void;
  /** Shown when the filter hides every item. */
  empty?: ReactNode;
}

/**
 * TOPIC UX, "Pickers": a small list with a filter, inside a modal. Focus stays in the filter; ↑/↓ move
 * through the items it lets through, Enter picks the highlighted one, a click picks one. Esc is the
 * modal's: it closes it.
 */
export function PickerList({ filterLabel, items, keep, onPick, empty }: PickerListProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const q = query.trim().toLowerCase();
  const shown = items.filter((item) => !q || keep?.(item) || item.label.toLowerCase().includes(q));
  const at = Math.min(active, Math.max(0, shown.length - 1));
  const optionId = (i: number) => `${id}-option-${i}`;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && shown[at]) {
      e.preventDefault();
      if (!e.repeat) onPick(shown[at].id);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="picker">
      <label className="relative flex items-center">
        <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
        <input
          type="search"
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={shown[at] ? optionId(at) : undefined}
          aria-label={filterLabel}
          placeholder={filterLabel}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-7 w-full min-w-0 rounded-md border border-input bg-background/60 pr-2 pl-7 text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/20"
        />
      </label>
      <div id={`${id}-list`} role="listbox" aria-label={filterLabel} className="flex max-h-72 min-w-0 flex-col gap-px overflow-y-auto">
        {shown.map((item, i) => (
          <div
            key={item.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === at}
            onMouseMove={() => setActive(i)}
            onClick={() => onPick(item.id)}
            className={cn('flex min-w-0 cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-body', i === at && 'bg-accent')}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            {item.hint && <span className="ml-auto shrink-0 text-meta text-muted-foreground">{item.hint}</span>}
          </div>
        ))}
        {shown.length === 0 && empty && <div className="px-2 py-1.5 text-meta text-muted-foreground">{empty}</div>}
      </div>
    </div>
  );
}
