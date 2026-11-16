import type { AwakeMode, AwakeSnapshot } from '@shared/awake.ts';
import { formatAge } from '@/lib/time';

/** AWAKE-4.3: the menu's three items, each with the line under it. */
export const AWAKE_ITEMS: readonly { mode: AwakeMode; label: string; line: string }[] = [
  { mode: 'off', label: 'Off', line: 'The Mac sleeps as usual' },
  { mode: 'awake', label: 'Awake', line: 'No idle sleep while Sessions are at work' },
  { mode: 'lid', label: 'Lid closed', line: 'Also with the lid shut, on the charger' },
];

/** AWAKE-4.2: the corner's state in words. */
export function cornerText(awake: AwakeSnapshot | null, now: number): string {
  if (!awake || awake.mode === 'off') return 'Sleeps as usual';
  if (awake.mode === 'lid' && awake.holding !== 'lid') return 'Awake · lid closed paused';
  const name = awake.holding === 'lid' ? 'Lid closed' : 'Awake';
  if (awake.offAt !== null) return `${name} · off in ${formatAge(awake.offAt - now)}`;
  return `${name} · ${awake.atWork} at work`;
}

/** AWAKE-4.1, 4.2: the corner's name and tooltip; the last note in the tooltip too. */
export function cornerTip(awake: AwakeSnapshot | null, now: number): string {
  const label = `Keep the Mac awake: ${cornerText(awake, now)}`;
  return awake?.note ? `${label}\n${awake.note.text}` : label;
}
