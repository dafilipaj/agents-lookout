import { pathToFileURL } from 'node:url';
import { type Outcome, type Refusal, serveCall } from './control.ts';
import type { TbSessionAnswer } from './outputs.ts';

/** C1/C2: contract fake only. It does not test mining, folding, persistence, or CLI performance. */
export function respond(argv: string[], answer: TbSessionAnswer): Outcome | Refusal {
  const [command, ...rest] = argv;
  if (!['outputs', 'list', 'search', 'show'].includes(command ?? '') || !rest.includes('--json')) return { refused: 'only outputs, list, search and show with --json are declared' };
  if (command === 'outputs' && answer.unsupported) return { code: 2, stderr: "error: unrecognized subcommand 'outputs'\n" };
  const values = new Map<string, string>();
  const unary = new Set(['--all-projects', '--json']);
  const binary = new Set(['--limit', '--page', '--kind', '--type', '--project', '--headless', '--q', '--harness', '--tail', '--session']);
  let positional = '';
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--') { positional = rest.slice(i + 1).join(' '); break; }
    if (unary.has(flag)) continue;
    if (!binary.has(flag)) return { refused: `undeclared flag ${flag}` };
    if (flag === '--q' && rest[i + 1] === '--') { values.set(flag, rest.slice(i + 2).join(' ')); break; }
    const value = rest[++i]; if (value === undefined) return { refused: `${flag} needs a value` }; values.set(flag, value);
  }
  if (command === 'show') {
    const row = answer.sessions.find((s) => s.session_id === positional && (!values.has('--harness') || s.harness === values.get('--harness')));
    return row ? { code: 0, stdout: JSON.stringify({ ...row, messages: [], messages_source: 'index', total_messages: 0 }) } : { code: 1, stdout: JSON.stringify({ error: 'session_not_found' }) };
  }
  let rows = command === 'outputs' ? answer.results : answer.sessions;
  const kinds = values.get('--kind')?.split(','), types = values.get('--type')?.split(','), q = (values.get('--q') ?? (command === 'search' ? positional : '')).toLocaleLowerCase();
  rows = rows.filter((r) => (!kinds || kinds.includes(String(r.kind))) && (!types || r.kind !== 'file' || types.includes(String(r.type))) && (!values.has('--project') || r.project_path === values.get('--project')) && (!values.has('--harness') || r.harness === values.get('--harness')) && (values.get('--headless') !== 'exclude' || r.headless !== true) && (values.get('--headless') !== 'only' || r.headless === true) && (!values.has('--session') || (r.sessions as Record<string, unknown>[] | undefined)?.some((s) => s.session_id === values.get('--session'))) && (!q || [r.title, r.key, r.first_prompt, (r.source as Record<string, unknown> | undefined)?.path, r.source_path].some((s) => typeof s === 'string' && s.toLocaleLowerCase().includes(q))));
  rows = [...rows].sort((a, b) => String(b.updated_at ?? b.modified_at).localeCompare(String(a.updated_at ?? a.modified_at)));
  const limit = Number(values.get('--limit') ?? '50'), page = Number(values.get('--page') ?? '1');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(page) || page < 1) return { refused: 'invalid page or limit' };
  return { code: 0, stdout: JSON.stringify({ total_results: rows.length, page, results: rows.slice((page - 1) * limit, page * limit) }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serveCall<TbSessionAnswer>('tb-session', respond);
