import { Inbox, Keyboard, MessagesSquare, Settings as SettingsIcon, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { PlaceButton, RailMark } from '@/components/ui/place-rail';
import { PLACES, PLACE_KEY, PLACE_LABEL, type Place } from '@/lib/places';
import { cn } from '@/lib/utils';
import { SHELL_COLUMN, ShellCell } from './Shell';

const PLACE_ICON: Record<Place, ComponentType<{ className?: string }>> = { inbox: Inbox, sessions: MessagesSquare, people: Users };

export interface PlaceRailProps {
  /** NAV-1.2: the place that shows. */
  place: Place;
  /** NAV-2.4: a place's button pressed. */
  onPlace(place: Place): void;
  /** NAV-3.1: the unread Reports. */
  unread: number;
  /** NAV-3.2: the Sessions that Need you. */
  needsYou: number;
  settingsOpen: boolean;
  onOpenSettings(): void;
  /** SIDE-7.3: the Keyboard shortcuts button; it is the opener the dialog returns focus to. */
  onShowShortcuts(opener: HTMLElement): void;
  /** TOOLS-2.4: the Tools that are missing or behind, named in Settings' tooltip. */
  attention: readonly string[];
}

/**
 * NAV-1: the rail at the window's left edge. Lookout's mark in the header row, the places under it,
 * and Keyboard shortcuts and Settings at its bottom. Focus on it counts as the place's list's
 * (NAV-4.3), so it carries the place.
 */
export function PlaceRail({ place, onPlace, unread, needsYou, settingsOpen, onOpenSettings, onShowShortcuts, attention }: PlaceRailProps) {
  const waiting: Record<Place, { count: number; words: string; tone: 'neutral' | 'needs-you' }> = {
    inbox: { count: unread, words: `${unread} unread`, tone: 'neutral' },
    sessions: { count: needsYou, words: needsYou === 1 ? '1 needs you' : `${needsYou} need you`, tone: 'needs-you' },
    // PEOPLE-3.1: nothing waits in People, so it has no count.
    people: { count: 0, words: '', tone: 'neutral' },
  };
  return (
    <div className={cn(SHELL_COLUMN, 'relative w-14 border-r border-sidebar-border bg-sidebar text-sidebar-foreground')} data-shell-column="rail" data-place={place} data-testid="place-rail">
      {/* NAV-1.1: Lookout's mark (DS-14) where the header line passes. */}
      <ShellCell row="header" className="justify-center border-sidebar-border">
        <RailMark />
      </ShellCell>
      {/* It runs on past the dock line, to the bottom, as the right sidebar does. */}
      <ShellCell row="body" toBottom className="flex flex-col items-center pt-1.5 pb-2">
        <nav aria-label="Places" className="flex flex-col items-center gap-1">
          {PLACES.map((p) => (
            <PlaceButton
              key={p}
              label={PLACE_LABEL[p]}
              icon={PLACE_ICON[p]}
              current={p === place}
              shortcut={PLACE_KEY[p]}
              count={waiting[p].count}
              countWords={waiting[p].words}
              tone={waiting[p].tone}
              onPress={() => onPlace(p)}
            />
          ))}
        </nav>
        {/* NAV-1.3: what the Session sidebar's header held, at the rail's bottom. DS-7.4: 4 px apart. */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <IconButton size="md" label="Keyboard shortcuts" onClick={(e) => onShowShortcuts(e.currentTarget)}>
            <Keyboard />
          </IconButton>
          <IconButton
            size="md"
            label="Settings"
            tip={attention.length ? `Settings: ${attention.join(', ')}` : undefined}
            aria-pressed={settingsOpen}
            onClick={onOpenSettings}
            className={cn('relative', settingsOpen && 'bg-sidebar-accent text-foreground')}
          >
            <SettingsIcon />
            {/* TOOLS-2.4: a Tool missing or behind; its name is in the tooltip. */}
            {attention.length > 0 && <span aria-hidden data-field="tools-dot" className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive" />}
          </IconButton>
        </div>
      </ShellCell>
    </div>
  );
}
