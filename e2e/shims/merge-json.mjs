import { readFileSync } from 'node:fs';
import process from 'node:process';

const [tool, rawPath, extrasPath, ...argv] = process.argv.slice(2);
const base = rawPath === '-' ? null : JSON.parse(readFileSync(rawPath, 'utf8'));
const extras = JSON.parse(readFileSync(extrasPath, 'utf8'));
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(2); };
if (!Array.isArray(extras)) fail(`${tool} merge sidecar must be a JSON array`);

if (tool === 'fleet-resume') {
  const at = argv.indexOf('--resume');
  if (at >= 0 && extras.some((row) => row.sessionId === argv[at + 1])) process.stdout.write(JSON.stringify({ ok: true }));
} else if (tool === 'fleet') {
  if (!Array.isArray(base)) fail('Fleet list --json must be a JSON array');
  const rows = base;
  const ids = new Set(rows.map((row) => row.session_id).filter(Boolean));
  const added = extras.filter((row) => row && row.session_id && !ids.has(row.session_id));
  process.stdout.write(JSON.stringify([...rows, ...added]));
} else if (tool === 'tb-session') {
  if (base === null || typeof base !== 'object' || Array.isArray(base) || !Array.isArray(base.results)) {
    fail('tb-session list/search/events --json must contain a results array');
  }
  if (argv[0] === 'events') {
    // Raw event facts always come from the pinned tool; no consumer grouping or fold here.
    process.stdout.write(JSON.stringify(base));
  } else {
    const query = argv[0] === 'search' ? String(argv.at(-1) ?? '').toLowerCase() : '';
    const rows = base.results;
    const ids = new Set(rows.map((row) => `${row.harness}:${row.session_id}`));
    const additions = extras.filter((row) => typeof row?.first_prompt === 'string' && row.first_prompt.toLowerCase().includes(query) && !ids.has(`${row.harness}:${row.session_id}`));
    const limitAt = argv.indexOf('--limit');
    const limit = limitAt < 0 ? 200 : Number(argv[limitAt + 1]);
    process.stdout.write(JSON.stringify({ ...base, ...(typeof base.total_results === 'number' ? { total_results: base.total_results + additions.length } : {}), results: [...rows, ...additions].slice(0, limit) }));
  }
} else if (tool === 'tb-session-show') {
  // A Session the test indexed, shown as tb-session would: nothing is printed for any other id, so the real `show` answers.
  const row = extras.find((r) => r?.session_id === argv.at(-1));
  if (row) process.stdout.write(JSON.stringify({ transcript_missing: false, messages: [], messages_source: 'index', total_messages: 0, ...row }));
} else {
  process.stderr.write(`unsupported test merge target: ${tool}\n`);
  process.exitCode = 2;
}
