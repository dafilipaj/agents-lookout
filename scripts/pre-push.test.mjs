import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installRoot, pinnedBin } from '../e2e/world/pins.ts';

/**
 * The pre-push hook in a repo of its own: the hook, `e2e/setup.ts` and the pin code copied in, the
 * pins "installed" where `pnpm e2e:setup` puts them (`installRoot`), and fakes of pnpm, tmux and
 * Playwright, so nothing slow or real runs.
 */
const REPO = fileURLToPath(new URL('../', import.meta.url));
// `server/cargo-record.ts`: the pin code reads cargo's install record through it, as Settings › Tools does (TOOLS-2.2).
const COPIED = ['.githooks/pre-push', 'e2e/setup.ts', 'e2e/world/pins.ts', 'server/cargo-record.ts', 'e2e/pins.json'];

let dir;
let pins;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-pre-push-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const file of COPIED) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(REPO, file), join(dir, file));
  }
  chmodSync(join(dir, '.githooks/pre-push'), 0o755);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { 'req-check': 'x', test: 'x', e2e: 'x' } }));
  const pw = join(dir, 'node_modules', '@playwright', 'test');
  mkdirSync(pw, { recursive: true });
  writeFileSync(join(pw, 'package.json'), JSON.stringify({ name: '@playwright/test', main: 'index.js' }));
  writeFileSync(join(pw, 'index.js'), 'module.exports = { chromium: { executablePath: () => __filename } };\n');
  const fakes = join(dir, 'fakes');
  mkdirSync(fakes);
  writeFileSync(join(fakes, 'pnpm'), `#!/bin/sh\necho "$*" >> '${join(dir, 'pnpm.log')}'\n`);
  writeFileSync(join(fakes, 'tmux'), '#!/bin/sh\nexit 0\n');
  for (const f of ['pnpm', 'tmux']) chmodSync(join(fakes, f), 0o755);
  pins = JSON.parse(readFileSync(join(dir, 'e2e', 'pins.json'), 'utf8'));
  for (const pin of Object.values(pins)) install(pin);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A binary where `pnpm e2e:setup` installs the pin, with the install record cargo leaves. */
function install(pin, rev = pin.rev) {
  const cache = join(dir, '.cache');
  const bin = pinnedBin(pin, cache);
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, `#!/bin/sh\necho "${pin.bin} ${pin.version ?? '0.0.0'}"\n`);
  chmodSync(bin, 0o755);
  const installs = { [`${pin.package} 0.0.0 (git+${pin.repo}?rev=${rev}#${rev})`]: {} };
  writeFileSync(join(installRoot(pin, cache), '.crates2.json'), JSON.stringify({ installs }));
}

function hook() {
  const res = spawnSync(join(dir, '.githooks/pre-push'), [], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { HOME: join(dir, 'home'), PATH: [join(dir, 'fakes'), dirname(process.execPath), '/usr/bin', '/bin'].join(':') },
  });
  let ran = [];
  try {
    ran = readFileSync(join(dir, 'pnpm.log'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    // pnpm never ran
  }
  return { code: res.status, stderr: res.stderr, ran };
}

describe('pre-push', () => {
  it('TEST-4.3: a pin installed where pnpm e2e:setup puts it passes, and the hook runs req-check, test and e2e, at half the usual parallelism', () => {
    const r = hook();
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.ran).toEqual(['req-check', 'test --maxWorkers=50%', 'e2e --workers=25%']);
  });

  it('TEST-4.3: a missing pin fails the hook before anything runs, naming it and the command that fixes it', () => {
    rmSync(installRoot(pins.tbSession, join(dir, '.cache')), { recursive: true });
    const r = hook();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pre-push: a binary pinned in e2e\/pins\.json is missing/);
    expect(r.stderr).toContain('tb-session: not installed');
    expect(r.stderr).toMatch(/pre-push: fix it with: pnpm e2e:setup\n$/);
    expect(r.ran).toEqual([]);
  });

  it('TEST-4.3: a pin built from another commit fails the hook like a missing one', () => {
    install(pins.fleet, '0123456789abcdef0123456789abcdef01234567');
    const r = hook();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`fleet: built from 0123456, not the pinned ${pins.fleet.rev.slice(0, 7)}`);
    expect(r.stderr).toMatch(/pre-push: fix it with: pnpm e2e:setup\n$/);
    expect(r.ran).toEqual([]);
  });
});
