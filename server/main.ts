import { Library } from './library.ts';
import { ChatSeen } from './chat-seen.ts';
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
import { PortsMonitor } from './ports.ts';
import { ResMonitor } from './res.ts';
import { sessionId } from './normalize.ts';
import { queuedFor } from '../shared/res.ts';
import { localAllowLists } from './security.ts';
import { SettingsStore, defaultSettingsPath, expandHome } from './settings.ts';
import { trackStartDirectories } from './start-repos.ts';
import { Changes } from './changes.ts';
import { PlainExamplesMaker } from './plain-examples.ts';
import { PlainWorktrees } from './plain-worktrees.ts';
import { Plain } from './plain.ts';
import { PlainPrs } from './plain-prs.ts';
import { ToolsMonitor } from './tools.ts';
import { TopicStore, Topics, defaultTopicsPath } from './topics.ts';
import { UsageMonitor, resolveJevBin } from './usage.ts';
import { Recommender } from './recommender.ts';
import { TopicLaunches } from './topic-launches.ts';
import { Suggester } from './suggester.ts';
import { Summarizer } from './summarizer.ts';
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
  onChange: (launches, started) => {
    // TOPIC-5.2: a start for a Topic is followed by its Session's row from here on.
    if (started.length) topicLaunches.started(started, monitor.snapshot().sessions);
    app.broadcast({ type: 'launches', launches, started });
  },
});

const work = new WorkMonitor({
  runner: run,
  tbPrBin: () => resolveWorkBin('tb-pr', env),
  tbProdBin: () => resolveWorkBin('tb-prod', env),
  tbSessionBin: () => resolveTbSessionBin(env),
  productiveEmail: settings.get().productiveEmail,
  onChange: (w) => {
    app.broadcast({ type: 'work', work: w });
    // TOPIC-12: member PRs and Tasks that changed are the Topics' activity.
    observeTopics(() => topics.observeWork(w, settings.get().productiveEmail));
    // TOPIC-9.1, TOPIC-9.2: its PRs and Tasks are candidates once; its Links tie what they can.
    recommender.observeWork(w);
  },
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
  // RES-3: read when the rows are derived, which runs only after start-up, once resQueue exists.
  queued: (row) => queuedFor(resQueue.snapshot(), row.id),
  onEvent: (e) => app.broadcast(e),
  onList: (rows) => {
    changes.observe(monitor.snapshot().sessions);
    memory.prune();
    launcher.observe(rows);
    work.setLiveSessions(rows.flatMap((row) => (row.session_id ? [row.session_id] : [])));
    // TOPIC-5.2: a Session Lookout started for a Topic joins it first, so it's never a candidate.
    topicLaunches.observe(monitor.snapshot().sessions);
    // TOPIC-12: member Sessions live again or ended are the Topics' activity.
    observeTopics(() => topics.observeSessions(monitor.snapshot().sessions));
    // TOPIC-9.1: a Session with a session id is a candidate once.
    recommender.observeSessions(monitor.snapshot().sessions);
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
// PLAIN: the Spec view reads Modules of the Checkouts DIFF counts.
// PLAIN-5: and a PR's commits, fetched into a clone Lookout knows: a Start directory's, a live Session's.
const plainPrs = new PlainPrs({
  runner: run,
  candidates: () => [
    ...settings.get().startDirectories.map((dir) => expandHome(dir)),
    ...monitor.snapshot().sessions.flatMap((row) => (row.cwd && row.git ? [row.cwd] : [])),
    ...changes.roots(),
  ],
  baseBranch: (repo, number) => {
    const prs = work.snapshot().prs;
    const pr = [...prs.mine, ...prs.reviewRequests].find((p) => p.repo.toLowerCase() === repo.toLowerCase() && p.number === number);
    return pr?.baseBranch ?? null;
  },
  env,
});
void plainPrs.prune();
setInterval(() => void plainPrs.prune(), 60 * 60 * 1000).unref();
const plain = new Plain({ runner: run, checkout: (sessionId, id) => changes.checkout(sessionId, id), prs: plainPrs });

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
  onChange: (u) => {
    app.broadcast({ type: 'usage', usage: u });
    recommender.kick();
  },
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

// PORTS: the Local servers, read while any tab is connected and tied to the Sessions in Fleet's list.
const ports = new PortsMonitor({
  runner: run,
  sessions: () => monitor.snapshot().sessions.map((s) => ({ id: s.id, harness: s.harness, pid: s.pid, cwd: s.cwd })),
  onChange: (p) => app.broadcast({ type: 'ports', ports: p }),
});

// RES: `res`'s queue, read while any tab is connected; its jobs are tied to Sessions by tmux session or id,
// and a waiting one marks its Session's row (RES-3), so a change refreshes the rows too.
const resQueue = new ResMonitor({
  runner: run,
  sessions: () => monitor.fleetRows().map((r) => ({ id: sessionId(r), tmuxSession: r.backend === 'tmux' && r.tmux_session ? r.tmux_session : null })),
  onChange: (r) => {
    monitor.refreshDerived();
    app.broadcast({ type: 'res', res: r });
  },
});

/** TOPIC-12.2, TOPIC-8.4: a Topics store that fails while recording activity is one log line; Lookout keeps running. */
function observeTopics(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn(`lookout: topics: recording activity failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// TOPIC-8: Lookout's own store of Topics; one that can't be opened leaves the Topics tab saying why.
const topicsPath = defaultTopicsPath(env);
const topics = new Topics({
  path: topicsPath,
  open: () => new TopicStore(topicsPath),
  exists: () => existsSync(topicsPath),
  onChange: (t) => app.broadcast({ type: 'topics', topics: t }),
});

// TOPIC-5.2: a Session started for a Topic is added to it once Fleet reports it.
const topicLaunches = new TopicLaunches({ topics });

// TOPIC-9: recommendations, Links first and Jev second; nothing is added without Accept.
const recommender = new Recommender({
  topics,
  runner: run,
  jevBin: () => resolveJevBin(env),
  jevReady: () => usage.snapshot()?.jev.state === 'ready',
  enabled: () => settings.get().recommendWithJev,
  firstPrompt: async (id, harness) => (await history.peek(id, harness)).firstPrompt,
  work: () => work.snapshot(),
  questionsDir: join(homedir(), '.lookout', 'jev', 'questions'),
  env,
  onNotReady: () => void usage.refreshJev().catch(() => {}),
});
topics.judgeAgainWith = (member) => recommender.judgeAgain(member);
topics.askAgainWith = () => recommender.askAgain();

// TOPIC-11: a summary of a Topic, one `claude -p` run when asked (decision 0013).
const summarizer = new Summarizer({
  topics,
  runner: run,
  claudeBin: async () => (await launcher.harnessFacts()).find((f) => f.id === 'claude' && f.installed)?.path ?? null,
  brief: (id, harness) => history.brief(id, harness),
  sessions: () => monitor.snapshot().sessions,
  work: () => work.snapshot(),
  runDir: join(homedir(), '.lookout', 'claude-run'),
  env,
});
topics.summarizer = summarizer;

// TOPIC-14: Suggest Topics, one `claude -p` run when asked, over the work in no Topic.
const suggester = new Suggester({
  topics,
  runner: run,
  claudeBin: async () => (await launcher.harnessFacts()).find((f) => f.id === 'claude' && f.installed)?.path ?? null,
  recent: (afterDay, limit) => history.recent(afterDay, limit),
  work: () => work.snapshot(),
  runDir: join(homedir(), '.lookout', 'claude-run'),
  env,
});
topics.suggester = suggester;

// PLAIN-11, 12: a Module's examples and port check, made on a press; kept 30 days unused. A PR's
// tests run in a worktree of its head (PLAIN-11.15); ones a run left behind go at start.
const plainWorktrees = new PlainWorktrees({ runner: run, env });
void plainWorktrees.prune();
const plainExamples = new PlainExamplesMaker({
  plain,
  runner: run,
  claudeBin: async () => (await launcher.harnessFacts()).find((f) => f.id === 'claude' && f.installed)?.path ?? null,
  runDir: join(homedir(), '.lookout', 'claude-run'),
  env,
  worktrees: plainWorktrees,
});
void plainExamples.prune();
setInterval(() => void plainExamples.prune(), 24 * 60 * 60 * 1000).unref();
settings.onChange(() => recommender.kick());

// WORK-2.8: a saved Productive email drops the Tasks kept for the previous one, and reads its own.
// Registered before the app's own listener, so tabs hear the list dropped before the new email.
settings.onChange((s) => work.setProductiveEmail(s.productiveEmail));

const chatSeen = new ChatSeen();
const app = createApp({
  attachmentsDir: join(homedir(), '.lookout', 'attachments'),
  // WORK-3.9: `LOOKOUT_AVATARS=off` (every World sets it) fetches none, so a Behaviour test never asks GitHub.
  ...(env.LOOKOUT_AVATARS === 'off' ? {} : { avatarsDir: join(homedir(), '.lookout', 'avatars') }),
  guard,
  monitor,
  settings,
  productiveEmailSuggestion,
  launcher,
  topicLaunches,
  viewer,
  usage,
  memory,
  ports,
  resQueue,
  work,
  changes,
  plain,
  chatSeen,
  plainClones: () => plainPrs.clones(),
  plainExamples,
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
  await Promise.all([recommender.close(), summarizer.close(), suggester.close(), plainExamples.close()]);
  topics.close();
  await Promise.all([usage.close().catch(() => {}), memory.close().catch(() => {}), ports.close().catch(() => {}), resQueue.close().catch(() => {}), work.close().catch(() => {}), tools.close().catch(() => {})]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
