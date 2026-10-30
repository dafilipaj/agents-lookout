import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLEET_INSTALL_COMMAND } from '../shared/defaults.ts';
import { TOOLS } from '../shared/tools.ts';
import { fleetRow } from './tools.ts';

const pins = JSON.parse(readFileSync(new URL('../e2e/pins.json', import.meta.url), 'utf8')) as {
  fleet: { repo: string; rev: string; package: string };
};

describe('FLEET_INSTALL_COMMAND', () => {
  it('TOOLS-2.3: installs the Fleet fork at the revision pinned in e2e/pins.json, so the sidebar never names an older Fleet', () => {
    expect(FLEET_INSTALL_COMMAND).toBe(`cargo install --git ${pins.fleet.repo} --rev ${pins.fleet.rev.slice(0, 7)} --locked ${pins.fleet.package}`);
  });

  it('TOOLS-2.3: names the same install as the README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(FLEET_INSTALL_COMMAND);
  });

  it('TOOLS-2.3: Settings › Tools gives the same command for a Fleet that is missing, behind or of an unknown revision, and judges it against the same pin', () => {
    expect(TOOLS.fleet.fix).toBe(FLEET_INSTALL_COMMAND);
    const base = { home: '/Users/me', checkedAt: 1, cargoRevision: null, pin: pins.fleet.rev };
    const found = { found: { path: '/Users/me/.cargo/bin/fleet', via: null } };
    const rows = [
      fleetRow({ ...base, lookup: { found: null, reason: 'Not found on PATH or in ~/.cargo/bin.' }, read: null }),
      fleetRow({ ...base, lookup: found, read: { line: 'fleet 0.1.0 (38a461c)' } }),
      fleetRow({ ...base, lookup: found, read: { line: 'fleet 0.1.0' } }),
    ];
    expect(rows.map((r) => [r.state, r.fix, r.pin])).toEqual([
      ['missing', FLEET_INSTALL_COMMAND, pins.fleet.rev.slice(0, 7)],
      ['behind', FLEET_INSTALL_COMMAND, pins.fleet.rev.slice(0, 7)],
      ['unknown', FLEET_INSTALL_COMMAND, pins.fleet.rev.slice(0, 7)],
    ]);
    // Lookout's minimum versions stay out of pins.json: it holds what the Worlds install.
    expect(Object.keys(pins.fleet).sort()).toEqual(['bin', 'branch', 'package', 'repo', 'rev']);
  });
});
