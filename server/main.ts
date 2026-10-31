import { Library } from './library.ts';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../shared/defaults.ts';
import { AnswerLedger } from './answerer.ts';
import { createApp } from './app.ts';
import { endSession } from './closer.ts';
import { type ModelSwitcherOptions, StatusSwitches, switchEffort, switchModel } from './model-switch.ts';
import { renameSession } from './renamer.ts';
import { run } from './exec.ts';
import { checkSessionPaths } from './files.ts';
import { fetchFleetList, resolveFleetBin } from './fleet.ts';
import { GitCache, readGitLocation, readGlobalGitEmail } from './git.ts';
import { History, resolveTbSessionBin, resumePast } from './history.ts';
import { Launcher } from './launcher.ts';
import { MemoryMonitor } from './memory.ts';
import { SessionMonitor } from './monitor.ts';
import { parsePort } from './port.ts';
import { localAllowLists } from './security.ts';
import { SettingsStore, defaultSettingsPath } from './settings.ts';
import { trackStartDirectories } from './start-repos.ts';
import { Changes } from './changes.ts';
import { ToolsMonitor } from './tools.ts';
import { TopicStore, Topics, defaultTopicsPath } from './topics.ts';
import { UsageMonitor } from './usage.ts';
import { Viewer } from './viewer.ts';
import { WorkMonitor, resolveWorkBin } from './work.ts';

const env = process.env;
// 0 lets the OS pick a free port (a Behaviour test's World); the bound port is printed below.
const requestedPort = parsePort(env.LOOKOUT_PORT, DEFAULT_PORT);
const production = env.NODE_ENV === 'production';
const token = env.LOOKOUT_TOKEN || randomBytes(24).toString('base64url');
// `pnpm dev` passes Vite's origin; nothing else is ever allowed.
const extraOrigins = (env.LOOKOUT_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// The Host and Origin allow-lists name the bound port, so they're filled once the server listens;
// until then they're empty and nothing is allowed.
const guard = { allowedHosts: new Set<string>(), allowedOrigins: new Set<string>(), token };

const settings = new SettingsStore(defaultSettingsPath(env));
await settings.load();
// WORK-2.5: read once; sent with the settings as a suggestion, never stored.
const productiveEmailSuggestion = await readGlobalGitEmail(run, env);

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

const work = new WorkMonitor({
  runner: run,
  tbPrBin: () => resolveWorkBin('tb-pr', env),
  tbProdBin: () => resolveWorkBin('tb-prod', env),
  tbSessionBin: () => resolveTbSessionBin(env),
  productiveEmail: settings.get().productiveEmail,
  onChange: (w) => app.broadcast({ type: 'work', work: w }),
  // TOOLS-2.5: a Tool too old for Work says which version it is.
  toolVersion: (tool) => tools.version(tool),
});

// VIEW-6.7, VIEW-7.7: model and Effort switches waiting for the Session's next reply, carried with its row.
const modelSwitches = new StatusSwitches();

const monitor: SessionMonitor = new SessionMonitor({
  fetchList: () => fetchFleetList(run, resolveFleetBin(env)),
  git,
  // SIDE-2.9: through the same cache, so a Start directory is read once and kept fresh with the rest;
  // a changed Start directory re-derives the rows.
  startRepos: trackStartDirectories(settings, git, () => monitor),
  models: modelSwitches,
  memoryGrowth: (row) => memory.growthFor(row),
  changes: (row) => changes.rowChanges(row),
  onEvent: (e) => app.broadcast(e),
  onList: (rows) => {
    changes.observe(monitor.snapshot().sessions);
    memory.prune();
    launcher.observe(rows);
    work.setLiveSessions(rows.flatMap((row) => (row.session_id ? [row.session_id] : [])));
  },
});

// DIFF: each live Session's Changes, asked of Fleet on its own schedule, one ask at a time.
const changes = new Changes({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  onRowsChanged: () => monitor.refreshDerived(),
  sendTo: (clientId, e) => app.sendTo(clientId, e),
  env,
});
// DIFF-4.3: base copies older than a day go, at start and once a day.
void changes.prune();
setInterval(() => void changes.prune(), 24 * 60 * 60 * 1000).unref();

// VIEW-6, VIEW-7: the status line's switches share one gate, one switch per Session process at a time.
const switcher: ModelSwitcherOptions = {
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  lookup: (sid) => monitor.get(sid),
  freshList: () => fetchFleetList(run, resolveFleetBin(env)),
  harnesses: () => launcher.harnesses(),
  dropHarnesses: () => launcher.dropHarnesses(),
  switches: modelSwitches,
  changed: () => monitor.refreshDerived(),
  refresh: () => monitor.pollNow(),
};

const viewer = new Viewer({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  lookup: (id) => monitor.get(id),
  freshList: () => fetchFleetList(run, resolveFleetBin(env)),
  sendTo: (clientId, e) => app.sendTo(clientId, e),
  // VIEW-4: what every tab answered or stopped, per Session. Answers and Stop go through the Viewer
  // (below), so they and the prompt reads share it.
  ledger: new AnswerLedger(),
});

const history = new History({ runner: run, bin: () => resolveTbSessionBin(env), toolVersion: () => tools.version('tb-session') });
/** HIST-3.2: live means in Fleet's current list; a fresh read, or the last one when that fails. */
const isLive = async (id: string, harness: string) => {
  const fresh = await fetchFleetList(run, resolveFleetBin(env));
  if (fresh.kind === 'ok') return fresh.rows.some((r) => r.session_id === id && r.harness === harness);
  return monitor.get(id)?.harness === harness;
};

const usage = new UsageMonitor({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  onChange: (u) => app.broadcast({ type: 'usage', usage: u }),
});

// TOOLS: every Tool, read on start (TOOLS-1.4) and when Settings opens; Harnesses from LAUNCH's
// cached `harness list`, tb-jev from USAGE's `status --json`, never run again here.
const tools: ToolsMonitor = new ToolsMonitor({
  runner: run,
  env,
  harnesses: (force) => launcher.harnessFacts(force),
  jev: () => usage.jevStatus(),
  onChange: (t) => app.broadcast({ type: 'tools', tools: t }),
});

const memory = new MemoryMonitor({
  runner: run,
  sessions: () => monitor.snapshot().sessions,
  onChange: (m) => {
    monitor.refreshDerived();
    app.broadcast({ type: 'memory', memory: m });
  },
});

// TOPIC-8: Lookout's own store of Topics; one that can't be opened leaves the Topics tab saying why.
const topicsPath = defaultTopicsPath(env);
const topics = new Topics({
  path: topicsPath,
  open: () => new TopicStore(topicsPath),
  exists: () => existsSync(topicsPath),
  onChange: (t) => app.broadcast({ type: 'topics', topics: t }),
});

// WORK-2.8: a saved Productive email drops the Tasks kept for the previous one, and reads its own.
// Registered before the app's own listener, so tabs hear the list dropped before the new email.
settings.onChange((s) => work.setProductiveEmail(s.productiveEmail));

const app = createApp({
  attachmentsDir: join(homedir(), '.lookout', 'attachments'),
  // WORK-3.9: `LOOKOUT_AVATARS=off` (every World sets it) fetches none, so a Behaviour test never asks GitHub.
  ...(env.LOOKOUT_AVATARS === 'off' ? {} : { avatarsDir: join(homedir(), '.lookout', 'avatars') }),
  guard,
  monitor,
  settings,
  productiveEmailSuggestion,
  launcher,
  viewer,
  usage,
  memory,
  work,
  changes,
  sessions: {
    answer: (id, req) => viewer.answer(id, req),
    stop: (id, status) => viewer.stopSession(id, status),
    rename: (id, name) =>
      renameSession(
        {
          runner: run,
          fleetBin: () => resolveFleetBin(env),
          lookup: (sid) => monitor.get(sid),
          freshList: () => fetchFleetList(run, resolveFleetBin(env)),
          refresh: () => monitor.pollNow(),
        },
        id,
        name,
      ),
    switchModel: (id, req) => switchModel(switcher, id, req),
    switchEffort: (id, req) => switchEffort(switcher, id, req),
    end: (id, target) =>
      endSession(
        {
          runner: run,
          fleetBin: () => resolveFleetBin(env),
          lookup: (sid) => monitor.get(sid),
          freshList: () => fetchFleetList(run, resolveFleetBin(env)),
          refresh: () => monitor.pollNow(),
        },
        id,
        target,
      ),
  },
  // VIEW-1.18: a Session's file links, resolved against the cwd of its last listed row.
  files: { check: (id, body) => checkSessionPaths({ lookup: (sid) => monitor.get(sid) }, id, body) },
  library: new Library({ runner: run, bin: () => resolveTbSessionBin(env), env, toolVersion: () => tools.version('tb-session'), onRead: (items, pruned) => topics.libraryRead(items, pruned) }),
  history: {
    find: (q) => history.find(q),
    detail: (id, harness) => history.detail(id, harness),
    peek: (id, harness) => history.peek(id, harness),
    resume: (input) => resumePast({ history, launcher, isLive }, input),
  },
  tools,
  topics,
  staticDir: production ? fileURLToPath(new URL('../dist/web', import.meta.url)) : null,
});

// TOOLS-1.4: the first read, when the server starts.
void tools.start();

app.server.listen(requestedPort, '127.0.0.1', () => {
  const { port } = app.server.address() as AddressInfo;
  const allow = localAllowLists(port, extraOrigins);
  for (const h of allow.allowedHosts) guard.allowedHosts.add(h);
  for (const o of allow.allowedOrigins) guard.allowedOrigins.add(o);
  // A World reads the bound port from this line.
  console.log(`Lookout server on http://127.0.0.1:${port}${production ? '' : ' (API only; open the Vite URL)'}`);
  console.log(`Settings: ${settings.path}`);
  if (env.LOOKOUT_TOKEN) console.log('Token: from LOOKOUT_TOKEN');
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  monitor.stop();
  launcher.stop();
  viewer.stop();
  app.server.close();
  app.server.closeAllConnections();
  // Cancel the pollers and wait until their processes have exited, so none is orphaned.
  topics.close();
  await Promise.all([usage.close().catch(() => {}), memory.close().catch(() => {}), work.close().catch(() => {}), tools.close().catch(() => {})]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
