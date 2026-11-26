import { type Pressure, formatBytes, runsAway } from '@shared/memory.ts';
import type { SessionRow } from '@shared/types.ts';
import { FlaskConicalOff, type LucideIcon, TrendingUp } from 'lucide-react';

/** SIDE-15: something Lookout finds wrong with a live Session by a rule of its own (Glossary: Warning). */
export interface Warning {
  kind: 'memory' | 'evidence';
  /** Its icon on the row's warning chip. */
  icon: LucideIcon;
  /** Its one word on the chip. */
  word: string;
  /** The Warning in words, for the chip's tooltip and the row's name (SIDE-15.3). */
  text: string;
}

/**
 * SIDE-15.1: a Session's Warnings, the most urgent first: memory running away (MEM-4.1), then work
 * its Evidence doesn't back (EVID-5.6). A new Warning is a new entry here, never a mark or a chip of
 * its own on the row.
 */
export function warningsOf(row: Pick<SessionRow, 'memoryGrowthBytes' | 'evidence'>, pressure: Pressure | null | undefined): Warning[] {
  const out: Warning[] = [];
  if (runsAway(row.memoryGrowthBytes, pressure)) {
    out.push({ kind: 'memory', icon: TrendingUp, word: 'Memory', text: `Memory +${formatBytes(row.memoryGrowthBytes!)} in 10 min` });
  }
  // An ok or quiet verdict, and a Session without Evidence, add nothing.
  if (row.evidence?.tone === 'warning') out.push({ kind: 'evidence', icon: FlaskConicalOff, word: 'Tests', text: row.evidence.text });
  return out;
}
