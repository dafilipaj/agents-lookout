import { pathToFileURL } from 'node:url';
import { type Outcome, type Refusal, serveCall } from './control.ts';
import type { TbSessionAnswer } from './outputs.ts';

/** Only the pre-events install hint uses this fake; ordinary Library Worlds run the pin. */
export function respond(argv: string[], answer: TbSessionAnswer): Outcome | Refusal {
  const [command, ...rest] = argv;
  if (!['events', 'list', 'search', 'show'].includes(command ?? '') || !rest.includes('--json')) return { refused: 'only events, list, search and show with --json are declared' };
  if (command === 'events' && answer.unsupported) return { code: 2, stderr: "error: unrecognized subcommand 'events'\n" };
  const values = new Map<string, string>();
  const unary = new Set(['--all-projects', '--json']);
  const binary = new Set(['--limit', '--page', '--kind', '--ext', '--project', '--headless', '--q', '--harness', '--tail', '--session']);
  let positional = '';
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--') { positional = rest.slice(i + 1).join(' '); break; }
    if (unary.has(flag)) continue;
    if (!binary.has(flag)) return { refused: `undeclared flag ${flag}` };
    const value = rest[++i]; if (value === undefined) return { refused: `${flag} needs a value` }; values.set(flag, value);
  }
  if (command === 'show') {
    const row = answer.sessions.find((s) => s.session_id === positional && (!values.has('--harness') || s.harness === values.get('--harness')));
    return row ? { code: 0, stdout: JSON.stringify({ ...row, messages: [], messages_source: 'index', total_messages: 0 }) } : { code: 1, stdout: JSON.stringify({ error: 'session_not_found' }) };
  }
  let rows = command === 'events' ? answer.results : answer.sessions;
  const kinds = values.get('--kind')?.split(','), extensions = values.get('--ext')?.split(',').map((v) => v.replace(/^\./, '').toLowerCase()), q = (values.get('--q') ?? (command === 'search' ? positional : '')).toLocaleLowerCase();
  rows = rows.filter((r) => (!kinds || kinds.includes(String(r.kind))) && (!extensions || extensions.includes(String(r.ext ?? '').toLowerCase())) && (!values.has('--project') || r.project_path === values.get('--project')) && (!values.has('--harness') || r.harness === values.get('--harness')) && (values.get('--headless') !== 'exclude' || r.headless !== true) && (values.get('--headless') !== 'only' || r.headless === true) && (!values.has('--session') || r.session_id === values.get('--session')) && (!q || [r.title, r.key, r.first_prompt, r.source_path].some((s) => typeof s === 'string' && s.toLocaleLowerCase().includes(q))));
  rows = [...rows].sort((a, b) => String(b.timestamp ?? b.modified_at).localeCompare(String(a.timestamp ?? a.modified_at)) || Number(b.id ?? 0) - Number(a.id ?? 0));
  const limit = Number(values.get('--limit') ?? '50'), page = Number(values.get('--page') ?? '1');
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(page) || page < 1) return { refused: 'invalid page or limit' };
  return { code: 0, stdout: JSON.stringify({ total_results: rows.length, page, results: rows.slice((page - 1) * limit, page * limit) }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serveCall<TbSessionAnswer>('tb-session', respond);
