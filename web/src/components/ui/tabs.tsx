import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** After the label, in `tabular-nums`: "Members 46". */
  count?: number;
  /** After the label, in place of a count: "Activity 3 new". */
  note?: string;
  /** Drawn after the label and its count; the page brings its own (TOPIC-13.2's). */
  dot?: ReactNode;
  /** What the dot means, said in the tab's name ("Members 46, new activity"). */
  dotLabel?: string;
}

/** A tab's name: its words with the spaces the layout's gap only shows. */
const tabName = (t: TabItem<string>) => [[t.label, t.count ?? t.note].filter((x) => x !== undefined).join(' '), t.dot ? t.dotLabel : undefined].filter(Boolean).join(', ');

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * DS-13.2: one thing seen in parts. A `tablist` of text tabs over one `tabpanel` per tab; only the
 * selected tab is in the Tab order, and ←/→ (wrapping), Home and End select another, focus
 * following. Each panel is a Tab stop of its own, so Tab goes into it even when it holds only text.
 * Panels not shown stay mounted and `hidden`, so a draft or an expanded part in one survives a switch. Controlled: the page keeps the selection (TOPIC-10.8: in the path).
 */
export function Tabs<T extends string>({ label, tabs, selected, onSelect, panels, className }: { label: string; tabs: readonly TabItem<T>[]; selected: T; onSelect(id: T): void; panels: Record<T, ReactNode>; className?: string }) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const base = slug(label);
  const tabId = (id: T) => `tab-${base}-${id}`;
  const panelId = (id: T) => `panel-${base}-${id}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const at = tabs.findIndex((t) => t.id === selected);
    const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = tabs[to]!.id;
    buttons.current.get(next)?.focus();
    if (next !== selected) onSelect(next);
  };

  return (
    <>
      <div role="tablist" aria-label={label} data-slot="tabs" className={cn('flex h-8 min-w-0 shrink-0 items-stretch border-b border-border', className)} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const active = t.id === selected;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) buttons.current.set(t.id, el);
                else buttons.current.delete(t.id);
              }}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={tabName(t)}
              aria-controls={panelId(t.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => !active && onSelect(t.id)}
              className={cn(
                '-mb-px flex min-w-0 items-center gap-1.5 border-b-2 px-2 text-body whitespace-nowrap transition-colors outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50',
                active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="text-meta font-normal text-muted-foreground tabular-nums">{t.count}</span>}
              {t.count === undefined && t.note && <span className="text-meta font-normal text-muted-foreground tabular-nums">{t.note}</span>}
              {t.dot}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={panelId(t.id)} role="tabpanel" aria-labelledby={tabId(t.id)} hidden={t.id !== selected} tabIndex={0} className="flex min-w-0 flex-col gap-5 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {panels[t.id]}
        </div>
      ))}
    </>
  );
}
