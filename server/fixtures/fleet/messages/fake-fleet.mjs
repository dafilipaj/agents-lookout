#!/usr/bin/env node
/* global process */
// A stand-in `fleet` for tests and manual runs. Implements `list`, `peek`, `send`, `spawn --json`
// (with `--resume`, the HIST contract; it never starts anything), `close --json` (the End
// Session contract, VIEW-5.6; it never closes anything, it only drops the row from list.json) and
// `messages --json` per the VIEW-1 contract (docs/features/session-view/SPEC.md), from
// hand-written fixtures; never real Transcripts.
//
//   FAKE_FLEET_DIR   fixture dir: list.json, sessions/<id>.json. Without it, the committed
//                    fixtures next to this file are read, and nothing is ever written.
//   FAKE_FLEET_LOG   when set, each call's argv is appended to it as one JSON line
//   A list row's `fake_close` (`busy`, `host_shared`, `io`) makes `close` fail with that kind, and
//   `fake_close_how` (`killed`) says how a close went; default `exit`. `close --expect-pid <n>
//   --expect-start <t>` (both or neither) fails `target_changed` unless the row's `pid` and
//   `proc_start` are exactly those, as the Fleet fork checks its live process.
//   FAKE_FLEET_REGISTER  `later`: a spawned Session doesn't show in `list` until
//                    `fake register`, as one stuck at a trust prompt; meanwhile a second
//                    `spawn --resume` of it within 30 s is `session_starting` (the HIST contract)
//
// A session file: { session_id, harness, transcript, generation, revision, busy, queue,
// padBefore?, entries }. Entry cursors are `c<generation>.<index>`; the top-level cursor adds a
// read hint, `c<generation>.<index>.r<revision>`, and `--after` reports as `updated` the entries
// changed since that revision (an entry's `rev`). Bump `generation` to simulate a rewrite.
//
// Changing a session (only with FAKE_FLEET_DIR), as the Harness would:
//   fake-fleet.mjs fake answer <id> <option index…>   answer the last pending question
//   fake-fleet.mjs fake grow <id> <text>              stream more text into the last reply
//   fake-fleet.mjs fake say <id> <text>               a new reply
//   fake-fleet.mjs fake busy <id> on|off              while busy, `send` queues the prompt
//   fake-fleet.mjs fake take <id>                     the Harness takes the first queued prompt
//   fake-fleet.mjs fake register                      spawned Sessions register (FAKE_FLEET_REGISTER)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const writable = !!process.env.FAKE_FLEET_DIR;
const dir = process.env.FAKE_FLEET_DIR || dirname(fileURLToPath(import.meta.url));
if (process.env.FAKE_FLEET_LOG) appendFileSync(process.env.FAKE_FLEET_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);

const dryRun = process.argv.includes('-n');
const argv = process.argv.slice(2).filter((a) => a !== '--local' && a !== '-n');
const cmd = argv.shift();

const list = () => JSON.parse(readFileSync(join(dir, 'list.json'), 'utf8'));
/** Spawned, not registered yet (FAKE_FLEET_REGISTER=later): `{ at, row }`. */
const pending = () => (existsSync(join(dir, 'pending.json')) ? JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8')) : []);
const STARTING_MS = 30_000;
const sessionFile = (id) => join(dir, 'sessions', `${id}.json`);

/** Exact match on session_id or pid, as Lookout's targets are. */
function resolve(target) {
  const rows = list();
  return rows.find((r) => r.session_id === target) ?? rows.find((r) => String(r.pid) === target) ?? null;
}

function fail(kind, error) {
  process.stdout.write(`${JSON.stringify({ ok: false, kind, error })}\n`);
  process.stderr.write(`error: ${error}\n`);
  process.exit(1);
}

/** Positional args after `--`, and `--opt value` / `--opt=value` options. */
function parse(args) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) opts[a.slice(2, eq)] = a.slice(eq + 1);
      else if (a === '--json') opts.json = true;
      else opts[a.slice(2)] = args[++i];
    } else pos.push(a);
  }
  return { opts, pos };
}

const read = (id) => (existsSync(sessionFile(id)) ? JSON.parse(readFileSync(sessionFile(id), 'utf8')) : null);
function save(id, s) {
  if (writable) writeFileSync(sessionFile(id), `${JSON.stringify(s, null, 2)}\n`);
}

function load(row) {
  const s = row.session_id ? read(row.session_id) : null;
  if (!s) return null;
  const pad = [];
  for (let k = 0; k < (s.padBefore ?? 0); k++) {
    const n = 1000 + k;
    const ts = new Date(Date.UTC(2026, 9, 16, 7, 0, 0) + k * 60_000).toISOString();
    if (k % 3 === 0) pad.push({ role: 'user', kind: 'user', text: `Check the rounding on invoice #${n} as well.`, ts });
    else if (k % 3 === 1) pad.push({ role: 'assistant', kind: 'tool_call', id: `toolu_pad_${k}`, tool: 'Read', summary: `spec/fixtures/invoices/${n}.yml`, text: '', ts });
    else pad.push({ role: 'assistant', kind: 'assistant', text: `Invoice #${n} totals match to the cent after rounding.`, ts, final: true });
  }
  return { ...s, all: [...pad, ...s.entries] };
}

function messages(args) {
  const { opts, pos } = parse(args);
  const target = pos[0];
  if (!target) fail('usage', 'missing <target>');
  if (opts.after !== undefined && opts.before !== undefined) fail('usage', '--after and --before cannot be used together');
  const row = resolve(target);
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  if (!row.session_id && row.harness === 'claude') fail('transcript_not_found', `session ${row.pid} has no session id yet`);
  const s = load(row) ?? { all: [], generation: 1, revision: 0, queue: [], transcript: null };
  const gen = s.generation ?? 1;
  const revision = s.revision ?? 0;
  const entries = s.all.map(({ rev: _rev, ...e }, i) => ({ cursor: `c${gen}.${i}`, ...e }));
  const revs = s.all.map((e) => e.rev ?? 0);
  const queue = (s.queue ?? []).map((q, n) => ({ cursor: `q1.${n}`, role: 'user', kind: 'user', text: q.text, ts: q.ts ?? null, queued: true }));
  const limit = Math.min(Number(opts.limit ?? 100), 500);
  const position = (c) => {
    const m = /^c(\d+)\.(\d+)(?:\.r(\d+))?$/.exec(c);
    if (!m || Number(m[1]) !== gen || Number(m[2]) >= entries.length) fail('cursor_invalid', `cursor ${c} not found (transcript rewritten?)`);
    return { i: Number(m[2]), rev: m[3] === undefined ? revision : Number(m[3]) };
  };
  const top = (i) => (i < 0 ? null : `c${gen}.${i}.r${revision}`);
  let out;
  let updated = [];
  let more;
  let cursor;
  let withQueue = true;
  if (opts.after !== undefined) {
    const { i, rev } = position(opts.after);
    out = entries.slice(i + 1, opts.limit !== undefined ? i + 1 + limit : undefined);
    updated = entries.slice(0, i + 1).filter((_, k) => revs[k] > rev);
    more = { before: i + 1 > 0, after: i + 1 + out.length < entries.length };
    cursor = top(i + out.length);
  } else if (opts.before !== undefined) {
    const { i } = position(opts.before);
    const start = Math.max(0, i - limit);
    out = entries.slice(start, i);
    more = { before: start > 0, after: true };
    cursor = top(i - 1);
    withQueue = false;
  } else {
    const start = Math.max(0, entries.length - limit);
    out = entries.slice(start);
    more = { before: start > 0, after: false };
    cursor = top(entries.length - 1);
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      session_id: row.session_id,
      harness: row.harness,
      transcript: s.transcript ?? null,
      entries: withQueue ? [...out, ...queue] : out,
      updated,
      has_more_before: more.before,
      has_more_after: more.after,
      cursor,
    })}\n`,
  );
}

const now = () => new Date().toISOString();

function send(args) {
  const { pos } = parse(args);
  const [target, text] = pos;
  const row = resolve(target ?? '');
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  const s = row.session_id ? read(row.session_id) : null;
  if (s && writable) {
    if (s.busy) (s.queue ??= []).push({ text, ts: now() });
    else {
      s.entries.push({ role: 'user', kind: 'user', text, ts: now() });
      s.entries.push({ role: 'assistant', kind: 'assistant', text: `Got it: *${text.split('\n')[0].slice(0, 60)}*`, ts: now(), final: true });
    }
    save(row.session_id, s);
  }
  process.stdout.write(`sent to ${row.display_title}\n`);
}

function peek(args) {
  const { pos } = parse(args);
  const row = resolve(pos[0] ?? '');
  if (!row) fail('target_not_found', `no session matches '${pos[0]}'`);
  const screen = row.fake_screen ?? ['', `  ${row.display_title}`, '', '  > '];
  process.stdout.write(`▼ ${row.display_title} (${row.backend}, ${row.status}) — ${row.cwd}\n${screen.join('\n')}\n`);
}

/**
 * `close <target> --json` (the Fleet fork's contract for VIEW-5.6): an exact `id:<session_id>` or
 * `pid:<n>` target only; only a Session alone in its own tmux session.
 */
function close(args) {
  const { opts, pos } = parse(args);
  if (!opts.json) fail('usage', 'close needs --json here');
  const target = pos[0] ?? '';
  const m = /^(?:id:([A-Za-z0-9][A-Za-z0-9-]*)|pid:([1-9][0-9]*))$/.exec(target);
  if (!m) fail('usage', `'${target}' is not an exact target (id:<session_id> or pid:<n>)`);
  const rows = list();
  const row = m[1] !== undefined ? rows.find((r) => r.session_id === m[1]) : rows.find((r) => String(r.pid) === m[2]);
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  const expectPid = opts['expect-pid'];
  const expectStart = opts['expect-start'];
  if ((expectPid === undefined) !== (expectStart === undefined)) fail('usage', '--expect-pid and --expect-start go together');
  if (expectPid !== undefined && (String(row.pid) !== expectPid || row.proc_start == null || row.proc_start !== expectStart)) {
    fail('target_changed', `the session's process is now pid ${row.pid} started ${row.proc_start ?? 'unknown'}`);
  }
  if (row.backend !== 'tmux') fail('backend_unsupported', `can't close a session on the ${row.backend} backend`);
  if (row.fake_close) fail(row.fake_close, `fake ${row.fake_close}`);
  if (!row.tmux_session || rows.some((r) => r !== row && r.tmux_session === row.tmux_session)) {
    fail('host_shared', `tmux session '${row.tmux_session}' hosts more than this session`);
  }
  if (writable && !dryRun) writeFileSync(join(dir, 'list.json'), `${JSON.stringify(rows.filter((r) => r !== row), null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: true, session_id: row.session_id, pid: row.pid, harness: row.harness, how: row.fake_close_how ?? 'exit', tmux_session: row.tmux_session, dry_run: dryRun })}\n`,
  );
}

/** `spawn --json`'s failure: exit 1, one object on stdout, the message on stderr. */
function spawnFail(kind, error, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, host: 'fake', kind, error, partial: null, ...extra })}\n`);
  process.stderr.write(`error: ${error}\n`);
  process.exit(1);
}

/**
 * `spawn --json` (docs/cli.md "Spawning" in the Fleet fork) and `spawn --resume` (the HIST
 * contract). Nothing is started: with FAKE_FLEET_DIR, the new Session is added to list.json, as
 * Fleet would report it once it registered.
 */
function spawn(args) {
  const { opts, pos } = parse(args);
  const harness = opts.harness ?? 'claude';
  if (!opts.json) fail('usage', 'this fake only speaks --json');
  if (opts.backend !== 'tmux') spawnFail('usage', 'this fake only spawns with --backend tmux');
  if (!opts.dir || !existsSync(opts.dir)) spawnFail('dir_missing', `dir does not exist: ${opts.dir}`);
  const resume = opts.resume;
  if (resume !== undefined) {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(resume)) spawnFail('usage', 'invalid session id');
    if (pos.length) spawnFail('usage', '--resume takes no prompt');
    if (harness === 'pi') spawnFail('harness_unsupported', 'pi cannot resume');
    const live = list().find((r) => r.session_id === resume && r.harness === harness);
    if (live) spawnFail('session_live', `session ${resume} is live (pid ${live.pid})`, { pid: live.pid });
    const starting = pending().find((p) => p.row.session_id === resume && p.row.harness === harness && Date.now() - p.at < STARTING_MS);
    if (starting) spawnFail('session_starting', `session ${resume} is starting; it hasn't registered yet`);
  }
  const base = (opts.name ?? opts.dir.split('/').filter(Boolean).pop() ?? 'session').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const rows = list();
  const taken = new Set([...rows, ...pending().map((p) => p.row)].map((r) => r.tmux_session));
  if (opts.name && taken.has(base)) spawnFail('name_taken', `tmux session \`${base}\` already exists — pick another --name`);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  const command = resume !== undefined ? (harness === 'codex' ? `codex resume ${resume}` : `claude --resume ${resume}`) : harness;
  if (writable) {
    const later = process.env.FAKE_FLEET_REGISTER === 'later';
    const all = later ? [] : rows;
    all.push({
      pid: 70000 + rows.length,
      session_id: resume ?? null,
      cwd: opts.dir,
      status: 'idle',
      waiting_for: null,
      updated_at: Date.now(),
      backend: 'tmux',
      tmux_session: name,
      display_title: name,
      context: null,
      harness,
      model: null,
      proc_start: new Date().toISOString(),
    });
    if (later) writeFileSync(join(dir, 'pending.json'), `${JSON.stringify([...pending(), { at: Date.now(), row: all[0] }], null, 2)}\n`);
    else writeFileSync(join(dir, 'list.json'), `${JSON.stringify(rows, null, 2)}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true, dry_run: false, host: 'fake', backend: 'tmux', tmux_session: name, tmux_window: `${name}:0`, handle: '%99',
      created_session: true, dir: opts.dir, harness, model: opts.model ?? null, name: opts.name ?? null,
      command: `cd '${opts.dir}' && ${command}`, prompt_file: null, from: null, ...(resume !== undefined ? { resumed: resume } : {}),
    })}\n`,
  );
}

/** Changes a session the way its Harness would; each change bumps the revision. */
function fake([what, id, ...rest]) {
  if (!writable) fail('usage', 'set FAKE_FLEET_DIR to a copy of the fixtures first');
  if (what === 'register') {
    writeFileSync(join(dir, 'list.json'), `${JSON.stringify([...list(), ...pending().map((p) => p.row)], null, 2)}\n`);
    writeFileSync(join(dir, 'pending.json'), '[]\n');
    return;
  }
  const s = read(id);
  if (!s) fail('target_not_found', `no session file for ${id}`);
  s.revision = (s.revision ?? 0) + 1;
  const touch = (e) => (e.rev = s.revision);
  if (what === 'answer') {
    const q = [...s.entries].reverse().find((e) => e.kind === 'question' && e.status === 'pending');
    if (!q) fail('usage', 'no pending question');
    const picked = rest.map(Number);
    q.status = 'answered';
    q.answer = { answers: [picked.map((i) => q.questions[0].options[i].label).join(', ')], picked: [picked] };
    touch(q);
  } else if (what === 'grow') {
    const a = [...s.entries].reverse().find((e) => e.kind === 'assistant');
    a.text += rest.join(' ');
    touch(a);
  } else if (what === 'say') {
    s.entries.push({ role: 'assistant', kind: 'assistant', text: rest.join(' '), ts: now(), final: true });
  } else if (what === 'busy') {
    s.busy = rest[0] === 'on';
  } else if (what === 'take') {
    const next = (s.queue ?? []).shift();
    if (next) s.entries.push({ role: 'user', kind: 'user', text: next.text, ts: now() });
  } else fail('usage', `unknown change ${what}`);
  save(id, s);
}

switch (cmd) {
  case 'list':
    process.stdout.write(`${JSON.stringify(list())}\n`);
    break;
  case 'messages':
    messages(argv);
    break;
  case 'send':
    send(argv);
    break;
  case 'peek':
    peek(argv);
    break;
  case 'spawn':
    spawn(argv);
    break;
  case 'close':
    close(argv);
    break;
  case 'harness':
    process.stdout.write('[]\n');
    break;
  case 'fake':
    fake(argv);
    break;
  default:
    process.stderr.write(`error: unrecognized subcommand '${cmd}'\n`);
    process.exit(2);
}
