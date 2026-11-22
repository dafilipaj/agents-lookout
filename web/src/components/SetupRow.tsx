import { type SetupItem, pluginOf, skillSwitchable } from '@shared/setup.ts';
import type { CSSProperties } from 'react';
import { Hits } from '@/components/ui/hits';
import { RowActions } from '@/components/ui/row-actions';
import { RowDetails, RowTitle } from '@/components/ui/row-details';
import { HARNESS_NAME, OFF_REASON, domId, firstLine, matchRanges, sourceLabel, stateOf, tipOf } from '@/lib/setup';
import { cn } from '@/lib/utils';
import { HarnessIcon } from './HarnessIcon';

/** SETUP-1.5, SETUP-3: an item's row, shared by Everywhere and This Session (SETUP-8.2, 9.3). */

/** DS-17.1: the hairline between rows starts where a row's name does, under its group's name. */
const ROW_INSET = { '--row-inset': '48px' } as CSSProperties;
const FLAT_INSET = { '--row-inset': '28px' } as CSSProperties;

export function Hit({ text, query }: { text: string; query: string }) {
  return <Hits text={text} ranges={matchRanges(text, query)} tight />;
}

interface RowProps {
  item: SetupItem;
  query: string;
  active: boolean;
  expanded: boolean;
  busy: boolean;
  onPress(e: { detail: number }): void;
  onOpen(): void;
  /** SETUP-4's switches; This Session's rows have none (SETUP-9.3). */
  onSkill?(on: boolean): void;
  onPlugin?(on: boolean): void;
  /** In place of the description's first line: This repo's own says its kind and where (SETUP-9.1). */
  meta?: string;
  /** Before the state line's facts: what ran says its count (SETUP-8.2). */
  lead?: string[];
  /** Its key in the list, when the item shows in more than one place (SETUP-8.2). */
  rowKey?: string;
  /** Not under a group: This repo's own (SETUP-9.1). */
  flat?: boolean;
}

/** SETUP-1.5: one line, its Harness, its name as it's called, its description's first line; expanded, SETUP-3. */
export function SetupRow({ item, query, active, expanded, busy, onPress, onOpen, onSkill, onPlugin, meta, lead = [], rowKey, flat = false }: RowProps) {
  const id = domId(rowKey ?? item.key);
  const plugin = onPlugin ? pluginOf(item) : null;
  const description = meta ?? (item.off ? [sourceLabel(item.source), OFF_REASON[item.off]].join(' · ') : firstLine(item.description));
  const offSkill = item.off === 'override' || item.off === 'override-missing';
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-expanded={expanded}
      aria-label={[item.name, firstLine(item.description), HARNESS_NAME[item.harness], item.off && `off, ${OFF_REASON[item.off]}`].filter(Boolean).join(', ')}
      aria-describedby={expanded ? `${id}-details-state ${id}-details` : undefined}
      onClick={onPress}
      data-slot="row"
      data-selected={active || undefined}
      data-field="item"
      data-kind={item.kind}
      style={flat ? FLAT_INSET : ROW_INSET}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md py-[7px] pr-2 text-body hover:bg-sidebar-accent/60', flat ? 'pl-2' : 'pl-7', active && 'bg-sidebar-accent')}
    >
      <div className={cn('flex min-w-0 gap-1.5', expanded ? 'items-start' : 'items-center')}>
        <span className="flex h-5 shrink-0 items-center">
          <HarnessIcon harness={item.harness} />
        </span>
        <RowTitle expanded={expanded} className={cn('font-medium', expanded ? 'flex-1' : 'max-w-[62%] shrink-0')}>
          <Hit text={item.name} query={query} />
        </RowTitle>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" data-field="description">
            <Hit text={description} query={item.off ? '' : query} />
          </span>
        )}
      </div>
      {expanded && (
        <RowDetails
          id={`${id}-details`}
          className="pl-5"
          state={[...lead, ...stateOf(item)]}
          stateTip={tipOf(item)}
          summary={<Summary item={item} query={query} />}
          links={[]}
          actions={
            // SETUP-3.2: Open in VS Code is what Enter runs; SETUP-4: the switches Claude Code has, under More.
            <RowActions
              name={item.name}
              primary={{ 'data-action': 'open-vscode', action: 'open-vscode', tip: 'Open in VS Code (Enter)', enabled: true, onPress: onOpen }}
              more={[
                // SETUP-4.5: X runs the first of them, the skill's own switch before its plugin's.
                onSkill && skillSwitchable(item) && (offSkill ? { id: 'turn-on', action: 'turn-on', group: 'manage', shortcut: 'X', enabled: !busy, onSelect: () => onSkill(true) } : { id: 'turn-off', action: 'turn-off', group: 'manage', shortcut: 'X', enabled: !busy, onSelect: () => onSkill(false) }),
                plugin && (item.off === 'plugin'
                  ? { id: 'turn-on-plugin', action: 'turn-on', label: `Turn on plugin ${plugin.name}`, group: 'manage', ...(skillSwitchable(item) ? {} : { shortcut: 'X' }), enabled: !busy, onSelect: () => onPlugin?.(true) }
                  : { id: 'turn-off-plugin', action: 'turn-off', label: `Turn off plugin ${plugin.name}…`, group: 'manage', ...(skillSwitchable(item) ? {} : { shortcut: 'X' }), enabled: !busy, onSelect: () => onPlugin?.(false) }),
              ]}
            />
          }
        />
      )}
    </div>
  );
}

/** SETUP-3.1: at most three lines: a skill's call and description, a hook's command, a server's command or URL. */
export function Summary({ item, query }: { item: SetupItem; query: string }) {
  const mono = 'font-mono break-all';
  if (item.kind === 'skill')
    return (
      <>
        {item.call && (
          <p className={cn(mono, 'truncate text-foreground')} title={item.call} data-field="call">
            {item.call}
          </p>
        )}
        {item.description && (
          <p className="line-clamp-2" title={item.description}>
            <Hit text={item.description} query={query} />
          </p>
        )}
      </>
    );
  if (item.kind === 'hook')
    return (
      <p className={cn(mono, 'line-clamp-3')} title={item.command} data-field="command">
        {item.command}
      </p>
    );
  if (item.kind === 'mcp')
    return (
      <p className={cn(mono, 'line-clamp-3')} data-field="command">
        {item.description}
      </p>
    );
  return item.description ? (
    <p className="line-clamp-3" title={item.description}>
      <Hit text={item.description} query={query} />
    </p>
  ) : null;
}

