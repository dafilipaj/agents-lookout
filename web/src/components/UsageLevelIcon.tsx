import type { UsageLevel } from '@shared/usage.ts';
import { LEVEL_ICON } from '@/lib/usage';
import { cn } from '@/lib/utils';

/** USAGE-1.2 / USAGE-3.1: the warning or critical icon, named for screen readers; nothing when normal. */
export function UsageLevelIcon({ level, className }: { level: UsageLevel; className?: string }) {
  const entry = LEVEL_ICON[level];
  if (!entry) return null;
  const Icon = entry.icon;
  return (
    <span role="img" aria-label={entry.label} title={entry.label} data-level={level} className={cn('inline-flex', entry.className, className)}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}
