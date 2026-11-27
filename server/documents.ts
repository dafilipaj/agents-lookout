import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DOCUMENT_TYPES, type OutputType, documentTypeOf } from '../shared/library.ts';

export { DOCUMENT_TYPES };

/** LIB-2.10, EVID-7.1: a path's document Type by its extension, case-insensitively; null when it isn't one. */
export function documentType(path: string): OutputType | null {
  return documentTypeOf(path);
}

/** LIB-2.10, DIFF-2.9: the Harness homes, in your home folder. */
export const HARNESS_HOMES = ['.claude', '.codex', '.pi'] as const;

const ROOTS_TTL_MS = 60_000;
const rootsCache = new Map<string, { at: number; roots: string[] }>();

function realOrNull(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

/**
 * LIB-2.10, DIFF-2.9: the Harness homes' roots, as HOME names them and as the filesystem resolves them: Fleet gives a
 * Checkout's root resolved, as git does (contract fleet-diff C3), so `~/.claude` as a symlink, or HOME under `/tmp`
 * on macOS (`/private/tmp`), still matches. Read again after a minute, so a home made or moved later is seen.
 */
export function harnessHomeRoots(home: string, now = Date.now()): string[] {
  const hit = rootsCache.get(home);
  if (hit && now - hit.at < ROOTS_TTL_MS) return hit.roots;
  const realHome = realOrNull(home);
  const roots = new Set<string>();
  for (const d of HARNESS_HOMES) {
    const root = join(home, d);
    roots.add(root);
    if (realHome) roots.add(join(realHome, d));
    const real = realOrNull(root);
    if (real) roots.add(real);
  }
  const list = [...roots];
  rootsCache.set(home, { at: now, roots: list });
  return list;
}

/** LIB-2.10, DIFF-2.9: whether a path is a Harness home or inside one, by HOME's path or the resolved one. */
export function inHarnessHome(path: string, home: string): boolean {
  return harnessHomeRoots(home).some((root) => path === root || path.startsWith(`${root}/`));
}
