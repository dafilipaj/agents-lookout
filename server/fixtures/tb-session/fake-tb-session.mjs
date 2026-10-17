#!/usr/bin/env node
/* global process */
// A stand-in `tb-session` for tests and manual runs. Implements `list`, `search` and `show`
// with `--json`, per the tb-session 0.3.0 contract in docs/features/history/SPEC.md (Technical
// approach), from hand-written synthetic Sessions; never real Transcripts. It never resumes.
//
//   FAKE_TB_SESSION_FILE     the sessions file (default: sessions.json next to this file)
//   FAKE_TB_SESSION_ROOT     what `@root` in a `project_path` stands for (default: this dir)
//   FAKE_TB_SESSION_VERSION  `0.2.0` behaves like the real tb-session 0.2.0 (checked against it
//                            with cli-toolbox's synthetic fixtures): Claude Code only; rows
//                            without `harness`, `headless` and `transcript_missing`; `list` rows
//                            without `first_prompt`, and empty Sessions listed (only subagent
//                            ones are left out); `show` gives the first 20 messages and no
//                            `messages_source`; `--headless`, `--harness` and `--tail` refused
//                            the way clap refuses them
//   FAKE_TB_SESSION_LOG      when set, each call's argv is appended to it as one JSON line
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const legacy = process.env.FAKE_TB_SESSION_VERSION === '0.2.0';
if (process.env.FAKE_TB_SESSION_LOG) appendFileSync(process.env.FAKE_TB_SESSION_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);

const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-V') {
  process.stdout.write(`tb-session ${legacy ? '0.2.0' : '0.3.0'}\n`);
  process.exit(0);
}
const cmd = args.shift();

const root = process.env.FAKE_TB_SESSION_ROOT || here;
const all = () =>
  JSON.parse(readFileSync(process.env.FAKE_TB_SESSION_FILE || join(here, 'sessions.json'), 'utf8')).map((s) => ({
    ...s,
    project_path: s.project_path?.replace(/^@root/, root),
  }));
/** What tb-session 0.3 lists at all: no subagent Sessions, none without a prompt. 0.2 knows only
 * Claude Code, and its `list` leaves out subagent Sessions only. */
const known = () => (legacy ? all().filter((s) => s.harness !== 'codex') : all());
const visible = () => known().filter((s) => !s.is_sidechain && s.first_prompt);
const listed = () => (legacy ? known().filter((s) => !s.is_sidechain) : visible());

function parse(list) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--') {
      pos.push(...list.slice(i + 1));
      break;
    }
    if (a === '--json' || a === '--all-projects') opts[a.slice(2)] = true;
    else if (a.startsWith('--')) {
      if (legacy && ['--headless', '--harness', '--tail'].includes(a)) {
        process.stderr.write(`error: unexpected argument '${a}' found\n\nUsage: tb-session ${cmd} [OPTIONS]\n`);
        process.exit(2);
      }
      opts[a.slice(2)] = list[++i];
    } else pos.push(a);
  }
  return { opts, pos };
}

function headlessFilter(rows, mode = 'include') {
  if (mode === 'exclude') return rows.filter((s) => s.headless !== true);
  if (mode === 'only') return rows.filter((s) => s.headless === true);
  return rows;
}

/** A row as `list`/`search` print it: an empty `project_path` is left out. */
function summary(s) {
  const out = {
    session_id: s.session_id,
    harness: s.harness,
    headless: s.headless ?? null,
    transcript_missing: !!s.transcript_missing,
    summary: s.summary,
    first_prompt: s.first_prompt,
    git_branch: s.git_branch,
    project_path: s.project_path || undefined,
    message_count: (s.messages ?? []).length,
    created_at: s.created_at,
    modified_at: s.modified_at,
  };
  if (legacy) {
    delete out.harness;
    delete out.headless;
    delete out.transcript_missing;
  }
  return out;
}

/** A 0.2 `list` row: no `first_prompt` (its `search` and `show` rows have one). */
function listRow(s) {
  const out = summary(s);
  if (legacy) delete out.first_prompt;
  return out;
}

const byRecent = (a, b) => (b.modified_at ?? '').localeCompare(a.modified_at ?? '');

function list(rest) {
  const { opts } = parse(rest);
  const limit = Number(opts.limit ?? 20);
  const page = Number(opts.page ?? 1);
  const rows = headlessFilter(listed(), opts.headless).sort(byRecent);
  process.stdout.write(
    `${JSON.stringify({ total_results: rows.length, page, results: rows.slice((page - 1) * limit, page * limit).map(listRow) })}\n`,
  );
}

function search(rest) {
  const { opts, pos } = parse(rest);
  const query = (pos[0] ?? '').toLowerCase();
  const limit = Number(opts.limit ?? 20);
  const hits = [];
  for (const s of headlessFilter(visible(), opts.headless)) {
    let score = 0;
    let first = null;
    for (const m of s.messages ?? []) {
      const at = m.content.toLowerCase().indexOf(query);
      if (at < 0) continue;
      score += m.content.toLowerCase().split(query).length - 1;
      first ??= { m, at };
    }
    if (!first) continue;
    const { m, at } = first;
    const snippet = `…${m.content.slice(Math.max(0, at - 30), at)}«${m.content.slice(at, at + query.length)}»${m.content.slice(at + query.length, at + query.length + 30)}…`;
    hits.push({ ...summary(s), relevance_score: -score, matched_snippet: snippet, matched_role: m.role });
  }
  // Best match first (BM25 ranks are negative: lower is better).
  hits.sort((a, b) => a.relevance_score - b.relevance_score);
  process.stdout.write(`${JSON.stringify({ query: pos[0] ?? '', total_results: hits.length, results: hits.slice(0, limit) })}\n`);
}

function show(rest) {
  const { opts, pos } = parse(rest);
  const id = pos[0];
  const matches = known().filter((s) => s.session_id === id && (!opts.harness || s.harness === opts.harness));
  if (matches.length === 0) fail({ error: 'session_not_found', message: `Session not found: ${id}` });
  if (matches.length > 1) {
    fail({
      error: 'ambiguous_session_id',
      message: `Ambiguous session id: ${id}`,
      query: id,
      candidates: matches.map((s) => ({ session_id: s.session_id, harness: s.harness })),
    });
  }
  const s = matches[0];
  const messages = (s.messages ?? []).map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }));
  const tail = opts.tail === undefined ? null : Number(opts.tail);
  const out = {
    ...summary(s),
    is_sidechain: !!s.is_sidechain,
    messages: tail === null ? messages.slice(0, 20) : messages.slice(-tail),
    messages_source: s.transcript_missing ? 'index' : 'transcript',
    total_messages: messages.length,
  };
  if (legacy) delete out.messages_source;
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function fail(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.stderr.write(`Error: ${obj.message}\n`);
  process.exit(1);
}

switch (cmd) {
  case 'list':
    list(args);
    break;
  case 'search':
    search(args);
    break;
  case 'show':
    show(args);
    break;
  default:
    process.stderr.write(`error: unrecognized subcommand '${cmd}'\n`);
    process.exit(2);
}
