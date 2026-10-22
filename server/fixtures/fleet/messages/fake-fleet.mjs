#!/usr/bin/env node
/* global process */
// A stand-in `fleet` for tests and manual runs. Implements `list`, `peek`, `send`, `rename`, `model`, `effort`, `harness list`, `spawn --json`
// (with `--resume`, the HIST contract; it never starts anything), `close --json` (the End
// Session contract, VIEW-5.6; it never closes anything, it only drops the row from list.json) and
// `messages --json` per the VIEW-1 contract (docs/features/session-view/SPEC.md), from
// hand-written fixtures; never real Transcripts.
//
//   FAKE_FLEET_DIR   fixture dir: list.json, sessions/<id>.json. Without it, the committed
//                    fixtures next to this file are read, and nothing is ever written.
//   FAKE_FLEET_LOG   when set, each call's argv is appended to it as one JSON line
//   `send [--json] [--force] [--require-empty] -- <target> <text>` (VIEW-3, VIEW-3.7; the Fleet
//   fork's "Sending"): a row's `fake_send` says what its input box shows: `text` (`fake_input`, or
//   a draft, is in the box) or `prompt` hold the send; `no_input_box` and `unreadable` hold it only
//   with `--require-empty`, else it's typed with a warning; `--force` types whatever it shows. Held:
//   exit 3, nothing typed, the message on stderr, and with `--json` `{ ok: false, host, kind:
//   "send_held", reason, error, input? }` (`input` only for `text` and `unreadable`). Any other
//   `fake_send` (`busy`, `backend_failed`, …) fails with that kind.
//   A list row's `fake_close` (`busy`, `host_shared`, `io`) makes `close` fail with that kind, and
//   `fake_close_how` (`killed`) says how a close went; default `exit`. `busy` and `host_shared`
//   carry the contract's `reason`: the row's `fake_close_reason` (`locked`, `editor_open`;
//   `shared_host`, `job_in_front`, `other_jobs`; anything, to test unknown ones), default `locked`
//   and `shared_host`; `fake_close_reason: null` leaves it out, as a Fleet before reasons did.
//   `close --expect-pid <n> --expect-start <t>` (both or neither) fails `target_changed` unless the row's `pid` and
//   `proc_start` are exactly those, as the Fleet fork checks its live process.
//   `answer <id:…|pid:…> --json [--allow-attached] (--list | --choice <n> [--prompt <id>] |
//   --question <tool_use_id> --answers <json>)` (VIEW-4, the Fleet fork's "Answering prompts"):
//   `--list` reports the row's `fake_prompt` (a permission prompt, `{ kind: 'permission',
//   incomplete: true, reason }`, a question form, a cut-off one `{ kind: 'question', incomplete:
//   true, id: null, … }`, or null); without one, a `waiting` row whose Transcript has a pending
//   question shows that question's form, untouched. Beside it, as the fork from ec4ed52 does,
//   `answerable`, `detail` (why not: the row's `fake_detail`, else what the prompt shows: `no_form`,
//   `clipped`, `cursor_moved`, `touched`) and `pane` (the row's `fake_pane`, default 200x50; `null`
//   too). `--choice` and `--question` check what Fleet checks (the prompt on screen, whole and
//   untouched, its id, the choice, the question pending and the one waiting, the Session
//   `waiting`, the answers' shape) and fail with Fleet's kinds, each failure with `detail` and
//   `pane`; with FAKE_FLEET_DIR an answer clears the prompt, records a question's answer and turns
//   the row `busy`. A row's `fake_answer` (any kind, e.g. `busy`, `outcome_uncertain`,
//   `prompt_changed`, `prompt_incomplete`) makes every answer fail with it, and `fake_detail`;
//   `fake_attached: true` (or the `iterm` backend) is `human_attached` unless `--allow-attached`.
//   `keys <id:…|pid:…> <key>… --json` (VIEW-4.4) presses nothing: it checks the key names
//   (`invalid_key`) and answers as Fleet does; a row's `fake_keys` (`busy`, `backend_failed`, …)
//   makes it fail with that kind. It doesn't change Status: edit list.json for that.
//   `rename <target> <name> [--json] [--require-empty] [--force] [--no-tmux-sync]` (VIEW-5.12, the
//   Fleet fork's `rename` with `--require-empty`, branch `lookout-rename-guard`): types nothing. It
//   cleans the name as Fleet does (trimmed, one line, cut to 64 characters; empty or multi-line is a
//   plain error, exit 1, no JSON). Held, unless `--force`: a `waiting` row (`held: "waiting"`), a busy
//   Codex row (`busy`), and the row's `fake_rename_held`: `input` and `waiting` always, `no_input_box`
//   and `unreadable` only with `--require-empty` (else it's typed anyway), `busy` too. Held: exit 3,
//   the report `{ ok: false, result: "held", held, … }` on stdout with `--json`, the message on stderr.
//   A row's `fake_rename` (`busy`, `backend_unsupported`, `io`, …) fails before the report with that
//   kind. Otherwise `renamed`, and with FAKE_FLEET_DIR the row's `display_title` becomes the name, as
//   the registry would; `fake_rename_confirm: false` answers `sent` and leaves the title alone.
//   `model <id:…|pid:…> <model-id> --json [--require-empty] [--expect-pid <n> --expect-start <t>]` (VIEW-6, the Fleet
//   fork's `model`, which holds as `--require-empty` whether given or not): types nothing, and changes nothing in list.json (Fleet's `model` follows only
//   with the Session's next reply: edit the row's `model` and `model_at` for that). Exact targets
//   only, the model id as Fleet checks it (`usage`); `--expect-*` as `close` (`target_changed`);
//   a Codex row is `harness_unsupported`, one off tmux `backend_unsupported`; a row that isn't
//   `idle` is `not_idle` with its `status`. A row's `fake_model_held` (`text`, `prompt`,
//   `no_input_box`, `unreadable`) holds it as `send --require-empty` does: exit 3, `send_held` with
//   that `reason` (and `input`, the row's `fake_input`, for `text` and `unreadable`). A row's
//   `fake_model` (any kind: `busy`, `host_shared`, `not_idle`, `model_not_found`, `switch_refused`,
//   `confirm_unrecognized`, `outcome_uncertain`, `io`, …) fails with that kind, carrying
//   `fake_model_reason` as `reason` (`not_idle`: as `status`), and `fake_model_error` as `error`
//   (Fleet's words, e.g. an `io` ending "nothing typed"; else `fake <kind>`). An `io` carries
//   `typed` as the fork does since e187158: the row's `fake_model_typed` (default true); `null`
//   leaves it out, as a Fleet before e187158 does. Otherwise `{ ok: true, host,
//   session_id, pid, harness, model, confirmed, switched_at, dry_run }`: `confirmed` is the row's
//   `fake_model_confirm` (default false), `switched_at` its `fake_switched_at`, else now.
//   `effort <id:…|pid:…> <level> --json [--require-empty] [--expect-pid <n> --expect-start <t>]` (VIEW-7,
//   the Fleet fork's `effort`, `model`'s sibling): the same checks, holds and failures, from the
//   row's `fake_effort`, `fake_effort_held`, `fake_effort_reason`, `fake_effort_error` and
//   `fake_effort_typed`; the level is checked for shape only (lowercase letters, at most 16:
//   `usage`). Otherwise `{ ok: true, host, session_id, pid, harness, effort, confirmed, saved,
//   switched_at, dry_run }`: `confirmed` the row's `fake_effort_confirm` (default false), `saved`
//   its `fake_effort_saved` (default: true but for `max`, as Claude Code 2.1.308 writes it).
//   `harness list --json` prints `harnesses.json` from the fixture dir, or `[]` without one.
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

/** Fleet's exact forms, `id:<session_id>` and `pid:<n>`; anything else as `resolve`. */
function resolveExact(target) {
  const m = /^(?:id:(.+)|pid:([1-9][0-9]*))$/.exec(target);
  if (!m) return resolve(target);
  const rows = list();
  return (m[1] !== undefined ? rows.find((r) => r.session_id === m[1]) : rows.find((r) => String(r.pid) === m[2])) ?? null;
}

/** Changes one row of list.json (only with FAKE_FLEET_DIR, and never under `-n`). */
function updateRow(row, patch) {
  if (!writable || dryRun) return;
  const rows = list().map((r) => (r.pid === row.pid && r.harness === row.harness ? { ...r, ...patch } : r));
  writeFileSync(join(dir, 'list.json'), `${JSON.stringify(rows, null, 2)}\n`);
}

function fail(kind, error, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, kind, ...extra, error })}\n`);
  process.stderr.write(`error: ${error}\n`);
  process.exit(1);
}

/** Options that take no value. */
const FLAGS = new Set(['json', 'list', 'allow-attached', 'force', 'require-empty', 'no-tmux-sync']);

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
      else if (FLAGS.has(a.slice(2))) opts[a.slice(2)] = true;
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

/** What `send` says for each reason it holds (the Fleet fork's wording, never the box's text). */
const HELD = {
  text: 'the input box already holds text; nothing sent',
  prompt: 'a prompt is waiting for its answer; nothing sent',
  no_input_box: 'no input box on screen; nothing sent',
  unreadable: 'cannot tell whether the input box is empty; nothing sent',
};

function send(args) {
  const { opts, pos } = parse(args);
  const [target, text] = pos;
  const row = resolve(target ?? '');
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  const shows = opts.force ? null : (row.fake_send ?? null);
  let warning = null;
  if (shows && !Object.hasOwn(HELD, shows)) fail(shows, `fake ${shows}; nothing sent`);
  if (shows === 'text' || shows === 'prompt' || ((shows === 'no_input_box' || shows === 'unreadable') && opts['require-empty'])) {
    if (opts.json) {
      const input = shows === 'text' || shows === 'unreadable' ? { input: row.fake_input ?? 'a draft left in the box' } : {};
      process.stdout.write(`${JSON.stringify({ ok: false, host: 'fake', kind: 'send_held', reason: shows, error: HELD[shows], ...input })}\n`);
    }
    process.stderr.write(`Error: ${HELD[shows]}\n`);
    process.exit(3);
  }
  if (shows) {
    warning = shows;
    process.stderr.write(`warning: typed without knowing the input box was empty: ${HELD[shows]}\n`);
  }
  const s = row.session_id ? read(row.session_id) : null;
  if (s && writable) {
    if (s.busy) (s.queue ??= []).push({ text, ts: now() });
    else {
      s.entries.push({ role: 'user', kind: 'user', text, ts: now() });
      s.entries.push({ role: 'assistant', kind: 'assistant', text: `Got it: *${text.split('\n')[0].slice(0, 60)}*`, ts: now(), final: true });
    }
    save(row.session_id, s);
  }
  if (opts.json) out({ ok: true, host: 'fake', target: { session_id: row.session_id, pid: row.pid }, ...(warning ? { warning } : {}) });
  else process.stdout.write(`sent to ${row.display_title}\n`);
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
  if (row.fake_close) fail(row.fake_close, `fake ${row.fake_close}`, closeReason(row.fake_close, row.fake_close_reason));
  if (!row.tmux_session || rows.some((r) => r !== row && r.tmux_session === row.tmux_session)) {
    fail('host_shared', `tmux session '${row.tmux_session}' hosts more than this session`, { reason: 'shared_host' });
  }
  if (writable && !dryRun) writeFileSync(join(dir, 'list.json'), `${JSON.stringify(rows.filter((r) => r !== row), null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: true, session_id: row.session_id, pid: row.pid, harness: row.harness, how: row.fake_close_how ?? 'exit', tmux_session: row.tmux_session, dry_run: dryRun })}\n`,
  );
}

/** `close`'s `reason` (VIEW-5.8): only `busy` and `host_shared` carry one. */
function closeReason(kind, reason) {
  const fallback = { busy: 'locked', host_shared: 'shared_host' }[kind];
  if (!fallback || reason === null) return {};
  return { reason: reason ?? fallback };
}

/** What `answer --list` reads off the screen: the row's `fake_prompt`, else a pending question's form. */
function screenPrompt(row) {
  if (row.fake_prompt !== undefined) return row.fake_prompt;
  if (row.status !== 'waiting' || row.harness !== 'claude') return null;
  const s = row.session_id ? read(row.session_id) : null;
  const q = s && [...s.entries].reverse().find((e) => e.kind === 'question' && e.status === 'pending');
  return q ? { kind: 'question', id: q.id, questions: q.questions, active: 0, untouched: true } : null;
}

const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);

/** The pane's size `answer` reports: the row's `fake_pane` (`null` too), else 200x50. */
const paneOf = (row) => (row.fake_pane !== undefined ? row.fake_pane : { cols: 200, rows: 50 });

/** Why `--choice` / `--question` would fail the screen checks now (`--list`'s `detail`), or null. */
function screenDetail(row, prompt) {
  if (row.fake_detail !== undefined) return row.fake_detail;
  if (prompt === null) return 'no_form';
  if (prompt.incomplete) return 'clipped';
  if (prompt.kind === 'permission') return prompt.selected === 1 ? null : 'cursor_moved';
  if (prompt.kind === 'question') return prompt.untouched ? null : 'touched';
  return null;
}

/** `answer` (VIEW-4): the Fleet fork's contract, docs/cli.md "Answering prompts". Types nothing. */
function answer(args) {
  const { opts, pos } = parse(args);
  // Before the target is known, a failure has no reason code and no pane.
  const early = (kind, error) => fail(kind, error, { detail: null, pane: null });
  if (!opts.json) early('usage', 'this fake only speaks --json');
  const modes = [opts.list === true, opts.choice !== undefined, opts.question !== undefined].filter(Boolean).length;
  if (modes !== 1) early('usage', 'give one of --list, --choice <n>, --question <tool_use_id> --answers <json>');
  if ((opts.answers !== undefined) !== (opts.question !== undefined)) early('usage', '--answers goes with --question (and it needs one)');
  const target = pos[0] ?? '';
  const row = resolveExact(target);
  if (!row) early('target_not_found', `no session matches '${target}'`);
  const base = { ok: true, session_id: row.session_id, harness: row.harness };
  const prompt = screenPrompt(row);
  if (opts.list) {
    const detail = screenDetail(row, prompt);
    return out({ ...base, prompt, answerable: detail === null, detail, pane: paneOf(row) });
  }
  // Every failure from here on carries a reason code (null where it isn't a screen check) and the pane.
  const refuse = (kind, error, detail = null, extra = {}) => fail(kind, error, { detail, pane: paneOf(row), ...extra });
  const promptKind = opts.choice !== undefined ? 'permission' : 'question';
  if (row.fake_answer) {
    refuse(row.fake_answer, `fake ${row.fake_answer}`, row.fake_detail ?? null, row.fake_answer === 'outcome_uncertain' ? { screen: prompt, prompt_kind: promptKind, steps: [] } : {});
  }
  if (opts.question !== undefined && row.harness !== 'claude') refuse('harness_unsupported', `${row.harness} questions are not answerable here (Claude Code only)`);
  if (!opts['allow-attached'] && (row.fake_attached || row.backend === 'iterm')) refuse('human_attached', 'a terminal client is attached to the session; nothing typed');
  if (row.backend === 'unknown') refuse('backend_unsupported', `${row.display_title} has no terminal fleet can read and type into`);
  return opts.choice !== undefined ? choose(row, base, prompt, opts, refuse) : answerQuestion(row, base, prompt, opts, refuse);
}

function choose(row, base, prompt, opts, refuse) {
  const n = Number(opts.choice);
  if (!Number.isInteger(n) || n < 1) refuse('usage', `--choice takes an answer's number, not ${JSON.stringify(opts.choice)}`);
  if (prompt?.kind === 'permission' && prompt.incomplete) refuse('prompt_incomplete', `${prompt.reason ?? 'the prompt cannot be read whole'}; nothing typed`, row.fake_detail ?? 'clipped');
  if (prompt?.kind !== 'permission') refuse('prompt_not_on_screen', 'the terminal is not showing a permission prompt; nothing typed', prompt ? 'different_prompt' : 'no_form');
  if (opts.prompt !== undefined && opts.prompt !== prompt.id) refuse('prompt_not_on_screen', `the terminal shows a different prompt now (${prompt.id}: "${prompt.title}"); nothing typed`, 'different_prompt');
  if (prompt.selected !== 1) refuse('prompt_not_on_screen', "someone moved the prompt's cursor (it is not on answer 1) — answer it in the terminal; nothing typed", 'cursor_moved');
  const choice = prompt.choices.find((c) => c.n === n);
  if (!choice) refuse('choice_invalid', `the prompt has answers 1–${prompt.choices.length}, not ${n}`);
  updateRow(row, { fake_prompt: null, status: 'busy', waiting_for: null });
  const { key: _key, ...shown } = choice;
  out({ ...base, answered: !dryRun, ...(dryRun ? { dry_run: true } : {}), prompt_kind: 'permission', prompt, choice: shown, method: 'key', steps: [{ key: String(n) }] });
}

function answerQuestion(row, base, prompt, opts, refuse) {
  let answers;
  try {
    answers = JSON.parse(opts.answers);
  } catch (e) {
    refuse('answer_invalid', `--answers is not JSON: ${e.message}`);
  }
  const s = row.session_id ? read(row.session_id) : null;
  if (!s) refuse('transcript_not_found', 'the session has no transcript yet');
  const all = s.entries.filter((e) => e.kind === 'question');
  const q = all.find((e) => e.id === opts.question);
  if (!q) refuse('question_not_found', `no question ${opts.question} in this session`);
  if (q.status === 'abandoned') refuse('question_not_active', `question ${q.id} was abandoned (a new prompt came before any answer)`);
  if (q.status !== 'pending') refuse('question_answered', `question ${q.id} is already ${q.status}`);
  const waiting = all.filter((e) => e.status === 'pending').map((e) => e.id);
  if (waiting.length !== 1 || waiting[0] !== q.id) refuse('question_not_active', `question ${q.id} is not the one call waiting (waiting: ${waiting.join(', ')})`);
  if (row.status !== 'waiting') refuse('not_waiting', `the session is ${row.status}, not waiting on a question`);
  const checked = validateAnswers(answers, q.questions, refuse);
  if (prompt?.kind === 'question' && prompt.incomplete) {
    refuse('prompt_incomplete', "the question form's answers run off the captured screen (taller than the terminal) — answer it there; nothing typed", row.fake_detail ?? 'clipped');
  }
  if (prompt?.kind !== 'question') refuse('prompt_not_on_screen', 'the terminal is not showing a question form; nothing typed', prompt ? 'different_prompt' : 'no_form');
  if (prompt.id !== q.id) refuse('prompt_not_on_screen', 'the terminal shows a different question form; nothing typed', 'different_prompt');
  if (!prompt.untouched) refuse('prompt_not_on_screen', 'the form has been touched (moved, ticked, typed or answered) — answer it there; nothing typed', 'touched');
  if (writable && !dryRun) {
    s.revision = (s.revision ?? 0) + 1;
    q.status = 'answered';
    q.answer = {
      answers: checked.map((a, i) => [...a.options.map((o) => q.questions[i].options[o].label), ...(a.text ? [a.text] : [])].join(', ')),
      picked: checked.map((a) => a.options),
    };
    q.rev = s.revision;
    save(row.session_id, s);
  }
  updateRow(row, { fake_prompt: undefined, status: 'busy', waiting_for: null });
  out({ ...base, answered: !dryRun, ...(dryRun ? { dry_run: true } : {}), prompt_kind: 'question', id: q.id, steps: [] });
}

/** Fleet's `validate_answer`: one answer per question, options in range, single-select exactly one. */
function validateAnswers(answers, questions, refuse) {
  if (!Array.isArray(answers) || answers.length !== questions.length) refuse('answer_invalid', `answers must be an array of ${questions.length}`);
  return answers.map((a, i) => {
    const q = questions[i];
    const opts = Array.isArray(a?.options) ? a.options : [];
    if (opts.some((n) => !Number.isInteger(n) || n < 0 || n >= q.options.length)) refuse('answer_invalid', `answers[${i}].options: unknown option`);
    const raw = typeof a?.text === 'string' ? a.text : '';
    // eslint-disable-next-line no-control-regex -- as Fleet: no control characters
    if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) refuse('answer_invalid', `answers[${i}].text must be a single line without control characters`);
    const text = raw.trim();
    const options = [...new Set(opts)].sort((x, y) => x - y);
    if (q.multiSelect ? options.length === 0 && !text : options.length + (text ? 1 : 0) !== 1) {
      refuse('answer_invalid', `answers[${i}]: pick ${q.multiSelect ? 'at least one option' : 'exactly one option'} or type something`);
    }
    return { options, text };
  });
}

const KEYS = new Set(['Escape', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Tab', 'BTab', 'Space', 'C-c']);

/** `keys` (VIEW-4.4): checks and answers as Fleet does; presses nothing. */
function keys(args) {
  const { opts, pos } = parse(args);
  if (!opts.json) fail('usage', 'this fake only speaks --json');
  const [target = '', ...names] = pos;
  if (!names.length) fail('usage', 'give at least one key');
  const bad = names.find((k) => !KEYS.has(k));
  if (bad) fail('invalid_key', `unknown key '${bad}'; nothing pressed`);
  const row = resolveExact(target);
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  if (row.backend === 'unknown') fail('backend_unsupported', `${row.display_title} has no terminal to drive`);
  if (row.fake_keys) fail(row.fake_keys, `fake ${row.fake_keys}`);
  out({ ok: true, host: 'fake', target: { session_id: row.session_id, pid: row.pid }, keys: names });
}

/** What `rename` says for each reason it holds (the Fleet fork's codes; never the box's text). */
const RENAME_HELD = {
  waiting: ' is waiting on you — nothing sent (--force overrides)',
  busy: ' is busy — nothing sent, rename it once the turn is over (--force overrides)',
  input: "'s input box holds text — nothing sent (--force overrides)",
  no_input_box: "'s input box is not on screen, so fleet cannot tell it is empty — nothing sent (--force overrides)",
  unreadable: "'s input box cannot be read — nothing sent (--force overrides)",
};

/** `rename` (VIEW-5.12): Fleet's report, holds and failures, as the fork gives them. Types nothing. */
function rename(args) {
  const { opts, pos } = parse(args);
  const [target = '', raw = ''] = pos;
  const row = resolveExact(target);
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    process.stderr.write(`error: ${trimmed ? 'name must be a single line' : 'empty name'}\n`);
    process.exit(1);
  }
  const name = [...trimmed].slice(0, 64).join('');
  if (row.fake_rename) fail(row.fake_rename, `fake ${row.fake_rename}; nothing sent`);
  const report = { ok: false, result: 'held', session_id: row.session_id, pid: row.pid, host: 'fake', from: row.display_title, title: name, held: null, tmux: null, message: '' };
  let held = null;
  if (!opts.force) {
    const shows = row.fake_rename_held ?? null;
    if (row.status === 'waiting') held = 'waiting';
    else if (row.harness !== 'claude' && row.status === 'busy') held = 'busy';
    else if (shows === 'no_input_box' || shows === 'unreadable') held = opts['require-empty'] ? shows : null;
    else if (shows) held = shows;
  }
  if (held) {
    report.held = held;
    report.message = `${row.display_title}${RENAME_HELD[held] ?? ' — held, nothing sent'}`;
    if (opts.json) out(report);
    process.stderr.write(`Error: ${report.message}\n`);
    process.exit(3);
  }
  const confirmed = row.fake_rename_confirm !== false;
  if (confirmed) updateRow(row, { display_title: name });
  report.ok = true;
  report.result = confirmed ? 'renamed' : 'sent';
  report.tmux = opts['no-tmux-sync'] ? null : { renamed: false, from: null, to: null, note: `tmux session '${row.tmux_session}' left alone (fake)` };
  report.message = confirmed ? `${row.display_title} → ${name}` : `sent \`/rename ${name}\` to ${row.display_title} — not reflected yet, check \`fleet list\``;
  if (opts.json) out(report);
  else process.stdout.write(`${report.message}\n`);
}

/** Fleet's `clean_model`: letters, digits and `._[]-/:`, at most 100. */
const MODEL_ID = /^[A-Za-z0-9._[\]/:-]{1,100}$/;

/** Fleet's `effort` level: lowercase letters, at most 16. */
const EFFORT_LEVEL = /^[a-z]{1,16}$/;

/**
 * `model` (VIEW-6) and `effort` (VIEW-7): the Fleet fork's checks, holds and result, as docs/cli.md
 * "Switching the model" and "Switching the effort" give them. Types nothing.
 */
function model(args, cmd = 'model') {
  const { opts, pos } = parse(args);
  if (!opts.json) fail('usage', 'this fake only speaks --json');
  const [target = '', id = ''] = pos;
  if (!/^(?:id:.+|pid:[1-9][0-9]*)$/.test(target)) fail('usage', `"${target}": ${cmd} takes an exact target, id:<session_id> or pid:<n> — never a fragment`);
  if (cmd === 'effort' && !EFFORT_LEVEL.test(id)) fail('usage', id ? `effort level "${id}" is not a lowercase word of at most 16 letters` : 'no effort level given');
  if (cmd === 'model' && !MODEL_ID.test(id)) fail('usage', id ? `model id "${id}" has characters outside the allowed set` : 'no model id given');
  const expectPid = opts['expect-pid'];
  const expectStart = opts['expect-start'];
  if ((expectPid === undefined) !== (expectStart === undefined)) fail('usage', '--expect-pid and --expect-start go together');
  const row = resolveExact(target);
  if (!row) fail('target_not_found', `no session matches '${target}'`);
  if (row.harness !== 'claude') fail('harness_unsupported', `session runs ${row.harness}: ${cmd} switches Claude Code sessions only; nothing typed`);
  if (expectPid !== undefined && (String(row.pid) !== expectPid || row.proc_start == null || row.proc_start !== expectStart)) {
    fail('target_changed', `the session's process is now pid ${row.pid} started ${row.proc_start ?? 'unknown'}; nothing typed`);
  }
  if (row.backend !== 'tmux') fail('backend_unsupported', `session runs in ${row.backend}, not a tmux pane; nothing typed`);
  const fake = (field) => row[`fake_${cmd}${field}`];
  if (fake('')) {
    const kind = fake('');
    const extra = fake('_reason') === undefined ? {} : kind === 'not_idle' ? { status: fake('_reason') } : { reason: fake('_reason') };
    if (kind === 'io' && fake('_typed') !== null) extra.typed = fake('_typed') ?? true;
    fail(kind, fake('_error') ?? `fake ${kind}`, { host: 'fake', ...extra });
  }
  if (row.status !== 'idle') fail('not_idle', `session is ${row.status}, not idle; nothing typed (try again once it is idle)`, { host: 'fake', status: row.status });
  const held = fake('_held');
  if (held) {
    const input = held === 'text' || held === 'unreadable' ? { input: row.fake_input ?? 'draft in the box' } : {};
    process.stdout.write(`${JSON.stringify({ ok: false, host: 'fake', kind: 'send_held', reason: held, error: `held (${held}); nothing typed`, ...input })}\n`);
    process.stderr.write(`error: held (${held}); nothing typed\n`);
    process.exit(3);
  }
  const value = cmd === 'effort' ? { effort: id, saved: dryRun ? null : (row.fake_effort_saved ?? id !== 'max') } : { model: id };
  out({
    ok: true, host: 'fake', session_id: row.session_id, pid: row.pid, harness: row.harness, ...value,
    confirmed: !dryRun && fake('_confirm') === true, switched_at: dryRun ? null : (row.fake_switched_at ?? new Date().toISOString()), dry_run: dryRun,
  });
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
      effort: null,
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
  case 'answer':
    answer(argv);
    break;
  case 'keys':
    keys(argv);
    break;
  case 'rename':
    rename(argv);
    break;
  case 'model':
    model(argv);
    break;
  case 'effort':
    model(argv, 'effort');
    break;
  case 'harness':
    process.stdout.write(existsSync(join(dir, 'harnesses.json')) ? readFileSync(join(dir, 'harnesses.json'), 'utf8') : '[]\n');
    break;
  case 'fake':
    fake(argv);
    break;
  default:
    process.stderr.write(`error: unrecognized subcommand '${cmd}'\n`);
    process.exit(2);
}
