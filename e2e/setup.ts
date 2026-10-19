// `pnpm e2e:setup` (TEST-1.3): installs the pinned Fleet fork and tb-session into `.cache/`, and
// Playwright's Chromium. Never writes to ~/.cargo/bin, ~/.local/bin or the user's own binaries:
// before anything is checked or installed, `.cache`, each install root and its `bin/` must be
// plain directories inside the repo (or not exist yet), never symlinks.
//
// `node e2e/setup.ts --check` installs nothing: it runs the pin check the World runs before its
// first test (`checkPins`), prints each problem and exits 1 when a pin is missing or doesn't
// match. The pre-push hook asks it, so where a pin lives is decided only in `e2e/world/pins.ts`
// (TEST-4.3).
import { spawnSync } from 'node:child_process';
import { CACHE_DIR, REPO_ROOT, assertInsideRepo, checkPin, checkPins, installArgs, layoutProblems, loadPins } from './world/pins.ts';

if (process.argv.includes('--check')) {
  const check = checkPins();
  if (!check.ok) {
    console.error(check.problems.join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

const pins = Object.values(loadPins());
const problems = [...new Set(pins.flatMap((pin) => layoutProblems(pin)))];
if (problems.length) {
  console.error(`✗ refusing to install:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
assertInsideRepo(CACHE_DIR, { create: true });

for (const pin of pins) {
  const before = checkPin(pin);
  if (before.ok) {
    console.log(`✓ ${pin.package} ${pin.rev.slice(0, 7)} already in .cache (${before.version})`);
    continue;
  }
  // Checked again right before cargo writes anything.
  const layout = layoutProblems(pin);
  if (layout.length) {
    console.error(`✗ refusing to install ${pin.package}: ${layout.join('; ')}`);
    process.exit(1);
  }
  console.log(`→ cargo ${installArgs(pin).join(' ')}`);
  const res = spawnSync('cargo', installArgs(pin), {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // A private repo (cli-toolbox) needs git's own credential helper, which libgit2 doesn't use.
    env: { ...process.env, CARGO_NET_GIT_FETCH_WITH_CLI: 'true' },
  });
  if (res.status !== 0) {
    console.error(`✗ installing ${pin.package} failed`);
    process.exit(1);
  }
  const after = checkPin(pin);
  if (!after.ok) {
    console.error(`✗ ${after.problem}`);
    process.exit(1);
  }
  console.log(`✓ ${pin.package} ${pin.rev.slice(0, 7)} (${after.version})`);
}

const pw = spawnSync('pnpm', ['exec', 'playwright', 'install', 'chromium'], { cwd: REPO_ROOT, stdio: 'inherit' });
if (pw.status !== 0) {
  console.error("✗ installing Playwright's Chromium failed");
  process.exit(1);
}
console.log('✓ e2e setup done');
