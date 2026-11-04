import type { PlainPrFiles } from '@shared/plain.ts';
import { createContext, useContext } from 'react';

/** PLAIN-5: what Work's "Specs" button needs from the app. */
export interface PrSpecsApi {
  /** PLAIN-5.4: the repos (lower-case) Lookout has a local clone of. */
  clones(): Promise<string[]>;
  /** PLAIN-5.1: the PR's changed Modules; `fresh` on opening and on Retry. */
  list(repo: string, number: number, fresh: boolean): Promise<PlainPrFiles>;
  /** PLAIN-5.1: opens a Module in the Spec view, as a new history entry. */
  onOpen(repo: string, number: number, path: string): void;
}

/** The API and the clones last read; null before the first read ends. */
export const PrSpecsContext = createContext<{ api: PrSpecsApi; clones: ReadonlySet<string> | null } | null>(null);

/** PLAIN-5.4: why a PR has no "Specs" button, once the clones are known; else null. */
export function useNoCloneReason(repo: string): string | null {
  const specs = useContext(PrSpecsContext);
  return specs?.clones && !specs.clones.has(repo.toLowerCase()) ? `No local clone of ${repo}` : null;
}
