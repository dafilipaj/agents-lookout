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
import { Bots, defaultBotsPath, mayRunBots } from './bots.ts';
import { createApp } from './app.ts';
import { readBuild } from './static.ts';
import { type CloserOptions, endSession } from './closer.ts';
import { type ModelSwitcherOptions, StatusSwitches, switchEffort, switchModel } from './model-switch.ts';
import { renameSession } from './renamer.ts';
import { run, runLog } from './exec.ts';
import { guardRejections } from './crash-guard.ts';
import { checkSessionPaths } from './files.ts';
import { People } from './people.ts';
import { PrivateFolders } from './private-folders.ts';
import { fetchFleetList, resolveFleetBin } from './fleet.ts';
import { GitCache, readGitLocation, readGlobalGitEmail } from './git.ts';
import { History, resolveTbSessionBin, resumePast } from './history.ts';
import { Launcher } from './launcher.ts';
import { MemoryMonitor } from './memory.ts';
import { SessionMonitor } from './monitor.ts';
import { parsePort } from './port.ts';
import { PortsMonitor } from './ports.ts';
import { ResMonitor } from './res.ts';
import { KeepAwake } from './awake.ts';
import { Setup } from './setup.ts';
import { Commands } from './commands.ts';
import { sessionId } from './normalize.ts';
import { queuedFor } from '../shared/res.ts';
import { localAllowLists } from './security.ts';
import { SettingsStore, defaultSettingsPath, expandHome } from './settings.ts';
import { trackStartDirectories } from './start-repos.ts';
import { Changes } from './changes.ts';
import { Evidence } from './evidence.ts';
import { PlainExamplesMaker } from './plain-examples.ts';
import { PlainSimplifier } from './plain-simplify.ts';
import { PlainWorktrees } from './plain-worktrees.ts';
import { Plain } from './plain.ts';
import { PlainPrs } from './plain-prs.ts';
import { ToolsMonitor } from './tools.ts';
import { TopicStore, Topics, defaultTopicsPath } from './topics.ts';
import { UsageMonitor, resolveJevBin } from './usage.ts';
import { Recommender } from './recommender.ts';
import { TopicLaunches } from './topic-launches.ts';
import { HandoffLaunches, Handoffs, defaultHandoffsPath, historyHarness, sessionDirectory } from './handoffs.ts';
import { Suggester } from './suggester.ts';
import { Summarizer } from './summarizer.ts';
import { Viewer } from './viewer.ts';
import { WorkMonitor, resolveWorkBin } from './work.ts';

const env = process.env;
// 0 lets the OS pick a free port (a Behaviour test's World); the bound port is printed below.
const requestedPort = parsePort(env.LOOKOUT_PORT, DEFAULT_PORT);
const production = env.NODE_ENV === 'production';

// Plan item 61: a failed promise nobody waited on is logged, not the end of the server; and each
// failed or slow CLI call leaves a line in the log (`server/exec.ts`).
guardRejections((line) => console.error(line));
runLog.write = (line) => console.error(line);
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

// HAND-3.3, HAND-4: the hand-offs, kept in `~/.lookout/handoffs.json`; a change re-derives the rows' links.
const handoffs = new Handoffs({
  path: defaultHandoffsPath(env),
  firstPrompt: (id, harness) => history.firstPromptText(id, harness),
  // Called later, once `history` exists (declared below).
  sessionHarness: (id, likely) => historyHarness(history)(id, likely),
  onChange: () => monitor.refreshDerived(),
});
handoffs.load();
const handoffLaunches = new HandoffLaunches(handoffs);

const launcher = new Launcher({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  settings,
  onChange: (launches, started) => {
    // TOPIC-5.2, HAND-3.3: a start for a Topic or from a Handover is followed by its Session's row from here on.
    if (started.length) {
      topicLaunches.started(started, monitor.snapshot().sessions);
      handoffLaunches.started(started, monitor.snapshot().sessions);
    }
    // BOT-4.3, BOT-4.5: a Bot's run follows its start: a Session, a Trust prompt, or a failure.
    bots.launches(launches, started);
    app.broadcast({ type: 'launches', launches, started });
  },
  // HAND-3.4: where the old Session works, as Fleet lists it at that moment, else as History has it.
  sessionDirectory: (id, harness) => sessionDirectory({ monitor, history })(id, harness),
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

// VIEW-13.1, SIDE-13.1: what you saw of each Session's chat, and when.
const chatSeen = new ChatSeen();
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
  // EVID-5.6: the verdict for the row's mark, read when the rows are derived.
  evidence: (row) => evidence.rowEvidence(row.id),
  // HAND-4: the Session it continues, and those that continue it.
  handoffs: (row) => handoffs.links(row.id),
  // SIDE-13.1: when you last saw it, for Unread.
  viewedAt: (row) => chatSeen.viewedAt(row.id),
  onEvent: (e) => {
    app.broadcast(e);
    // EVID-1.3: who stopped with Changes, was marked Done again, or had a shell or a Subagent end.
    if (e.type === 'sessions') evidence.observe(monitor.snapshot().sessions);
    // AWAKE-2.1: who's At work follows every change to the rows.
    if (e.type === 'sessions') awake.sessionsChanged();
  },
  onList: (rows) => {
    changes.observe(monitor.snapshot().sessions);
    memory.prune();
    launcher.observe(rows);
    work.setLiveSessions(rows.flatMap((row) => (row.session_id ? [row.session_id] : [])));
    // TOPIC-5.2: a Session Lookout started for a Topic joins it first, so it's never a candidate.
    topicLaunches.observe(monitor.snapshot().sessions);
    // HAND-3.3, HAND-4.3: a start from a Handover is recorded; then any other Session's first prompt is read once for its `Continued from:` line.
    handoffLaunches.observe(monitor.snapshot().sessions);
    handoffs.observe(monitor.snapshot().sessions);
    // TOPIC-12: member Sessions live again or ended are the Topics' activity.
    observeTopics(() => topics.observeSessions(monitor.snapshot().sessions));
    // TOPIC-9.1: a Session with a session id is a candidate once.
    recommender.observeSessions(monitor.snapshot().sessions);
    // BOT-4.3 to 4.5: each run going is followed by its Session's row; after the launcher's `observe`, which may have just reported it.
    bots.observe(monitor.snapshot().sessions);
  },
});

// DIFF: each live Session's Changes, asked of Fleet on its own schedule, one ask at a time.
const changes = new Changes({
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  onRowsChanged: () => monitor.refreshDerived(),
  // EVID-1.5: a Session's Changes changed: its verdict is worked out again.
  onChanged: (sessionId) => evidence.changesChanged(sessionId),
  sendTo: (clientId, e) => app.sendTo(clientId, e),
  env,
});
// EVID: what backs a Session's work when it stops, from its commands (tb-session) and its Changes.
const evidence = new Evidence({
  runner: run,
  bin: () => resolveTbSessionBin(env),
  env,
  checkouts: (sessionId) => changes.checkouts(sessionId),
  broadcast: (e) => app.broadcast(e),
  onRowsChanged: () => monitor.refreshDerived(),
  // EVID-6.2: Subagent calls are asked for from the tb-session that has them.
  toolVersion: () => tools.version('tb-session'),
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
const plain = new Plain({ runner: run, checkout: (sessionId, id) => changes.checkout(sessionId, id), prs: plainPrs, checkoutsFile: join(homedir(), '.lookout', 'plain-checkouts.json') });

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
// VIEW-5.6: how a Session is ended, for End Session and for a Bot's finished run (BOT-4.6).
const closer: CloserOptions = {
  runner: run,
  fleetBin: () => resolveFleetBin(env),
  lookup: (sid) => monitor.get(sid),
  freshList: () => fetchFleetList(run, resolveFleetBin(env)),
  refresh: () => monitor.pollNow(),
};
// LIB: the Library, read by its panel, by Topics and by a Bot's run for what its Session produced (INBOX).
// PEOPLE-2: the Private folders in Settings, asked at every read of a document. A change of them, or of the
// Vault folder, holds at once: the Library's kept reads are dropped, and its next one leaves private files out.
const privateFolders = new PrivateFolders({ home: env.HOME });
void privateFolders.set(settings.get());
settings.onChange((s) => void privateFolders.set(s));
const library = new Library({ runner: run, bin: () => resolveTbSessionBin(env), env, toolVersion: () => tools.version('tb-session'), onRead: (items, pruned) => topics.libraryRead(items, pruned), isPrivate: (path) => privateFolders.covers(path), inVault: (path, whenSlow) => privateFolders.inVault(path, whenSlow) });
// PEOPLE-3, PEOPLE-4: the people in the Vault, read from its folder and file names at each ask. A note a Person's
// page names is listed for the Document view, which still asks the Private folders at every read.
const people = new People({
  settings: () => settings.get(),
  home: env.HOME,
  isPrivateFolder: (path) => privateFolders.coversFolder(path),
  allow: (path) => library.files.allow(path),
});
// BOT, INBOX: the Bots, their schedule and their runs, in `~/.lookout/bots.json` (or the file `LOOKOUT_BOTS` names).
// The server holding the store's lock looks for due Bots, with no tab open; a second one only shows them (BOT-2.6).
const bots = new Bots({
  path: defaultBotsPath(env),
  // BOT-2.6: a development server never runs the default store's Bots; `LOOKOUT_BOTS` gives it a store of its own.
  mayOwn: mayRunBots(env),
  launcher,
  monitor,
  library,
  history,
  // INBOX: a run's last reply, through the chat feed's reader, before its Session is ended.
  latest: (sessionId) => viewer.latest(sessionId),
  // BOT-4.6: asked once more of a fresh list: never one that went back to work, asks something, or was opened since the last poll.
  end: (sessionId, target, only) => endSession(closer, sessionId, target, { only }),
  // BOT-4.6: a Session you opened since its row was last derived is yours too.
  viewedAt: (sessionId) => chatSeen.viewedAt(sessionId),
  onChange: (b) => app.broadcast({ type: 'bots', bots: b }),
});
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
  onChange: (t) => {
    app.broadcast({ type: 'tools', tools: t });
    // EVID-6.2: a tb-session version that changes whether Subagent calls can be asked for reads again.
    evidence.toolsChanged();
  },
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

// SETUP: what Claude Code and Codex load for every Session, read from their files when the tab opens.
const setup = new Setup({
  home: homedir(),
  runner: run,
  claudeBin: async () => (await launcher.harnessFacts()).find((f) => f.id === 'claude' && f.installed)?.path ?? null,
});

// VIEW-15, LAUNCH-8: what a `/` lists: Setup's skills and the Built-in commands Lookout keeps.
const commands = new Commands({ setup });

// AWAKE: keep-awake, held by the server so it outlives the tab; restored from its file on start.
const awake = new KeepAwake({
  runner: run,
  sessions: () => monitor.snapshot().sessions,
  onChange: (a) => app.broadcast({ type: 'awake', awake: a }),
  file: join(homedir(), '.lookout', 'keep-awake.json'),
  pid: process.pid,
  env,
  // AWAKE-2.1: while on, it reads Fleet's list itself, so who's At work is known with no tab open.
  watchSessions: () => monitor.watch(),
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

// PEOPLE-2.6: what is private changed, by a save in Settings or by the disk saying where a folder really
// is. Whatever was drawn from a read under the old rule goes: the Library's kept reads, every Topic's
// Output lines (read again here, since no view asks), and each Report's title and what it holds.
privateFolders.onChange(() => {
  library.privacyChanged();
  if (topics.forgetOutputs()) library.refresh();
  bots.privacyChanged();
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
// PLAIN-14: a Module's changed specs in simple words, on a press; kept 30 days unused.
const plainSimple = new PlainSimplifier({
  plain,
  runner: run,
  claudeBin: async () => (await launcher.harnessFacts()).find((f) => f.id === 'claude' && f.installed)?.path ?? null,
  runDir: join(homedir(), '.lookout', 'claude-run'),
  env,
});
void plainSimple.prune();
setInterval(() => void plainSimple.prune(), 24 * 60 * 60 * 1000).unref();
settings.onChange(() => recommender.kick());

// WORK-2.8: a saved Productive email drops the Tasks kept for the previous one, and reads its own.
// Registered before the app's own listener, so tabs hear the list dropped before the new email.
settings.onChange((s) => work.setProductiveEmail(s.productiveEmail));

/** The built UI; null in `pnpm dev`, where Vite serves it. */
const staticDir = production ? fileURLToPath(new URL('../dist/web', import.meta.url)) : null;
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
  handoffLaunches,
  viewer,
  usage,
  memory,
  ports,
  resQueue,
  awake,
  setup,
  commands,
  work,
  changes,
  evidence,
  plain,
  chatSeen,
  plainClones: () => plainPrs.clones(),
  plainExamples,
  plainSimple,
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
    end: (id, target) => endSession(closer, id, target),
  },
  // VIEW-1.18: a Session's file links, resolved against the cwd of its last listed row.
  files: { check: (id, body) => checkSessionPaths({ lookup: (sid) => monitor.get(sid), isPrivate: (path) => privateFolders.covers(path) }, id, body) },
  library,
  people,
  inVault: (path, whenSlow) => privateFolders.inVault(path, whenSlow),
  bots,
  history: {
    find: (q) => history.find(q),
    // HAND-4: a past Session's hand-offs come from the record when History opens it.
    detail: async (id, harness) => ({ ...(await history.detail(id, harness)), ...handoffs.links(id) }),
    peek: (id, harness) => history.peek(id, harness),
    resume: (input) => resumePast({ history, launcher, isLive }, input),
  },
  tools,
  topics,
  staticDir,
  build: () => readBuild(staticDir),
});

// TOOLS-1.4: the first read, when the server starts.
void tools.start();
// BOT-2.6, BOT-3.2, BOT-4.7: the store's lock is taken, the store read, the runs a server before this one left
// going picked up, and the 30 s look begins.
bots.start();
// PEOPLE-2.6: a Report named while this server was stopped, or by another one, after a file that is private
// by now: its title is taken back from the file's own path. No read of the Library at start.
bots.privacyChanged({ reread: false });
// AWAKE-1.3: the saved mode comes back; an Amphetamine call may wait on macOS, so not before listening.
void awake.start();

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
  // BOT-2.6: the store's lock is given up, so the next server to start runs the Bots.
  bots.stop();
  viewer.stop();
  app.server.close();
  app.server.closeAllConnections();
  // Cancel the pollers and wait until their processes have exited, so none is orphaned.
  await Promise.all([recommender.close(), summarizer.close(), suggester.close(), plainExamples.close(), plainSimple.close()]);
  topics.close();
  // AWAKE-1.4: caffeinate and an owned Amphetamine session end before the server does.
  await awake.close().catch(() => {});
  await Promise.all([usage.close().catch(() => {}), memory.close().catch(() => {}), ports.close().catch(() => {}), resQueue.close().catch(() => {}), work.close().catch(() => {}), tools.close().catch(() => {})]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
