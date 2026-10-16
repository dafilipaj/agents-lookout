import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../shared/defaults.ts';
import { createApp } from './app.ts';
import { run } from './exec.ts';
import { fetchFleetList, resolveFleetBin } from './fleet.ts';
import { GitCache, readGitLocation } from './git.ts';
import { Launcher } from './launcher.ts';
import { SessionMonitor } from './monitor.ts';
import { localAllowLists } from './security.ts';
import { SettingsStore, defaultSettingsPath } from './settings.ts';
import { Viewer } from './viewer.ts';

const env = process.env;
const port = Number(env.LOOKOUT_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid LOOKOUT_PORT: ${env.LOOKOUT_PORT}`);
const production = env.NODE_ENV === 'production';
const token = env.LOOKOUT_TOKEN || randomBytes(24).toString('base64url');
// `pnpm dev` passes Vite's origin; nothing else is ever allowed.
const extraOrigins = (env.LOOKOUT_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const settings = new SettingsStore(defaultSettingsPath(env));
await settings.load();

const git = new GitCache({
  read: (cwd) => readGitLocation(run, cwd),
  onChange: () => monitor.refreshDerived(),
});

const launcher = new Launcher({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  settings,
  onChange: (launches, started) => app.broadcast({ type: 'launches', launches, started }),
});

const monitor = new SessionMonitor({
  fetchList: () => fetchFleetList(run, resolveFleetBin(env)),
  git,
  onEvent: (e) => app.broadcast(e),
  onList: (rows) => launcher.observe(rows),
});

const viewer = new Viewer({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  lookup: (id) => monitor.get(id),
  freshList: () => fetchFleetList(run, resolveFleetBin(env)),
  sendTo: (clientId, e) => app.sendTo(clientId, e),
});

const app = createApp({
  guard: { ...localAllowLists(port, extraOrigins), token },
  monitor,
  settings,
  launcher,
  viewer,
  staticDir: production ? fileURLToPath(new URL('../dist/web', import.meta.url)) : null,
});

app.server.listen(port, '127.0.0.1', () => {
  console.log(`Lookout server on http://127.0.0.1:${port}${production ? '' : ' (API only; open the Vite URL)'}`);
  console.log(`Settings: ${settings.path}`);
  if (env.LOOKOUT_TOKEN) console.log('Token: from LOOKOUT_TOKEN');
});

const shutdown = () => {
  monitor.stop();
  launcher.stop();
  viewer.stop();
  app.server.close();
  app.server.closeAllConnections();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
