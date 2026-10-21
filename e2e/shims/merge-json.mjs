import { readFileSync } from 'node:fs';
import process from 'node:process';

const [tool, rawPath, extrasPath, ...argv] = process.argv.slice(2);
const base = rawPath === '-' ? null : JSON.parse(readFileSync(rawPath, 'utf8'));
const extras = JSON.parse(readFileSync(extrasPath, 'utf8'));
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(2); };
if (!Array.isArray(extras)) fail(`${tool} merge sidecar must be a JSON array`);

if (tool === 'fleet') {
  if (!Array.isArray(base)) fail('Fleet list --json must be a JSON array');
  const rows = base;
  const ids = new Set(rows.map((row) => row.session_id).filter(Boolean));
  const added = extras.filter((row) => row && row.session_id && !ids.has(row.session_id));
  process.stdout.write(JSON.stringify([...rows, ...added]));
} else if (tool === 'tb-session') {
  if (base === null || typeof base !== 'object' || Array.isArray(base) || !Array.isArray(base.results)) {
    fail('tb-session search --json must contain a results array');
  }
  const query = String(argv.at(-1) ?? '').toLowerCase();
  const rows = base.results;
  const additions = extras.filter((row) => typeof row?.first_prompt === 'string' && row.first_prompt.toLowerCase().includes(query));
  process.stdout.write(JSON.stringify({ ...base, results: [...rows, ...additions].slice(0, 200) }));
} else if (tool === 'tb-session-show') {
  // A Session the test indexed, shown as tb-session would: nothing is printed for any other id, so the real `show` answers.
  const row = extras.find((r) => r?.session_id === argv.at(-1));
  if (row) process.stdout.write(JSON.stringify({ transcript_missing: false, messages: [], messages_source: 'index', total_messages: 0, ...row }));
} else {
  process.stderr.write(`unsupported test merge target: ${tool}\n`);
  process.exitCode = 2;
}
