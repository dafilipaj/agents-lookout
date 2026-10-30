import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLEET_INSTALL_COMMAND } from '../shared/defaults.ts';

const pins = JSON.parse(readFileSync(new URL('../e2e/pins.json', import.meta.url), 'utf8')) as {
  fleet: { repo: string; rev: string; package: string };
};

describe('FLEET_INSTALL_COMMAND', () => {
  it('installs the Fleet fork at the revision pinned in e2e/pins.json, so the sidebar never names an older Fleet', () => {
    expect(FLEET_INSTALL_COMMAND).toBe(`cargo install --git ${pins.fleet.repo} --rev ${pins.fleet.rev.slice(0, 7)} --locked ${pins.fleet.package}`);
  });

  it('names the same install as the README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(FLEET_INSTALL_COMMAND);
  });
});
