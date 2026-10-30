import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What `cargo install` recorded in an install root's `.crates2.json`: whether the package is
 * installed there, and the commit it was built from when it came from git. Shared by the e2e pin
 * check (`e2e/world/pins.ts`, TEST-1.3) and Settings › Tools (TOOLS-2.2), so both read it one way.
 */
export type CargoRecord =
  | { state: 'no-record' }
  | { state: 'not-installed' }
  /** `revision`: the full commit after `#` in the source, e.g. `fleet 0.1.0 (git+https://…?rev=5e2afd8#5e2afd8c…)`; null for a source without one. */
  | { state: 'installed'; revision: string | null };

export function readCargoRecord(root: string, pkg: string, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): CargoRecord {
  let installs: Record<string, unknown>;
  try {
    const parsed = JSON.parse(read(join(root, '.crates2.json'))) as { installs?: unknown };
    installs = typeof parsed.installs === 'object' && parsed.installs !== null ? (parsed.installs as Record<string, unknown>) : {};
  } catch {
    return { state: 'no-record' };
  }
  const source = Object.keys(installs).find((k) => k.startsWith(`${pkg} `));
  if (!source) return { state: 'not-installed' };
  return { state: 'installed', revision: /#([0-9a-f]{7,40})\)$/.exec(source)?.[1] ?? null };
}
