import type { SessionRow } from '@shared/types.ts';
import { GROWTH_BYTES, formatBytes, watchedLevel, type MemorySnapshot } from '@shared/memory.ts';
import type { UsageLevel } from '@shared/usage.ts';
import { formatAge } from './time';

export { formatBytes } from '@shared/memory.ts';

export const MEMORY_GLYPH: Record<UsageLevel, string> = { normal: 'bg-muted-foreground', warning: 'bg-warning', critical: 'bg-destructive' };
export const MEMORY_TEXT: Record<UsageLevel, string> = { normal: 'text-muted-foreground', warning: 'text-warning-text', critical: 'text-destructive-text' };

export function memoryDescription(memory: MemorySnapshot, now: number, sessions: readonly SessionRow[]): string {
  const level = watchedLevel(memory);
  const growing = sessions.filter((s) => (s.memoryGrowthBytes ?? 0) >= GROWTH_BYTES).length;
  const age = formatAge(now - memory.sampledAt).replace(/^(\d+)s$/, '$1 s');
  return `Memory: ${formatBytes(memory.watchedBytes)} watched of ${formatBytes(memory.ramBytes).replace('.0 GB', ' GB')}, pressure ${memory.pressure}, ${memory.old ? 'old, ' : ''}sampled ${age} ago${level === 'normal' ? '' : `, memory ${level}`}${growing ? `, ${growing} Session${growing === 1 ? '' : 's'} growing` : ''}`;
}
