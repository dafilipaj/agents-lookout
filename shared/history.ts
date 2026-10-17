import type { HistoryBlock } from './types.ts';

/** HIST-3.3: why a past Session can't be resumed, for people. */
export const BLOCK_REASON: Record<HistoryBlock, string> = {
  'folder-gone': 'The directory it started in no longer exists.',
  'transcript-missing': 'Its Transcript was deleted.',
  'no-folder': "tb-session doesn't know where it started.",
};
