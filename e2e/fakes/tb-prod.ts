import type { TaskDecl, TbProdDecl } from '../world/builder.ts';
import { type Outcome, type Printed, type Refusal, serveCall } from './control.ts';
import { type Condition, type Group, parseFilter, validateFilter } from './tb-prod-filter.ts';

/**
 * The fake `tb-prod` (TEST-1.5, WORK's Dependencies). It answers one call, `tb-prod query tasks`
 * with WORK's filter (WORK's Sources), with the Tasks declared for the filter's assignee email, one
 * JSON:API page of 20 as tb-prod prints it, or fails as declared: no config, an `api_error` with
 * status 401 or 403, or no answer at all.
 *
 * Anything else is a violation, which fails the Behaviour test. Where tb-prod itself refuses the
 * call, the fake prints what tb-prod prints: clap's usage error (exit 2) for argv clap can't parse,
 * such as `--sort -last_activity_at` in two words, and `invalid_json` or `invalid_filter` (exit 1,
 * JSON on stdout) for a filter tb-prod rejects (tb-prod-filter.ts). Otherwise it refuses in its own
 * words: another subcommand or resource; a filter tb-prod would take but that isn't WORK's, since
 * the fake can't tell which Tasks it would return; no sort, or any but WORK's `-last_activity_at`,
 * since tb-prod has no default sort for Tasks and the fake can't tell Productive's own order; an
 * include other than `project` and `workflow_status`. The real one would reach Productive with
 * your account, and could write to it.
 */

const PAGE_SIZE = 20;
const OPTIONS = ['filter', 'sort', 'page', 'include'] as const;
type Option = (typeof OPTIONS)[number];
type Options = Partial<Record<Option, string>>;
/** What `--include` may name: the relations a Task row shows (WORK-2.2). */
const INCLUDES = new Set(['project', 'workflow_status']);
/** WORK's sort (its Sources): the most recently active Tasks first, so its 5 pages hold the newest. */
const WORK_SORT = '-last_activity_at';

/**
 * WORK's filter (its Sources): an `and` of exactly these and `assignee.email eq <email>`, the open
 * Tasks of active projects, task lists and folders. What the fake answers means this filter and no
 * other, so when WORK's filter changes, this changes with it, checked against tb-prod.
 */
const WORK_SCOPE: readonly Condition[] = [
  { field: 'project.status', operator: 'eq', value: '1' },
  { field: 'task_list_status', operator: 'eq', value: '1' },
  { field: 'folder_status', operator: 'eq', value: '1' },
  { field: 'workflow_status_category_id', operator: 'not_eq', value: '3' },
];
const WORK_FILTER = ['assignee.email eq <email>', ...WORK_SCOPE.map((c) => `${c.field} ${c.operator} ${String(c.value)}`)].join(', ');

const NO_CONFIG: Printed = {
  stderr: 'Error: Config error: No config found. Run `tb-prod config init --token <TOKEN>` or create secrets.toml with [productive] section\n',
  code: 1,
};

const refuse = (why: string): Refusal => ({ refused: why });
const isOption = (name: string): name is Option => (OPTIONS as readonly string[]).includes(name);
const placeholder = (name: Option) => `--${name} <${name.toUpperCase()}>`;

/** clap's usage error, as tb-prod prints it before it does anything else: exit 2, on stderr. */
function clap(why: string, error: string, opts: { tip?: string; usage?: string | null } = {}): Refusal {
  const usage = opts.usage === undefined ? 'tb-prod query [OPTIONS] <RESOURCE_TYPE>' : opts.usage;
  const parts = [`error: ${error}`, ...(opts.tip ? [`  tip: ${opts.tip}`] : []), ...(usage ? [`Usage: ${usage}`] : []), "For more information, try '--help'."];
  return { refused: why, outcome: { stderr: `${parts.join('\n\n')}\n`, code: 2 } };
}

/** clap on an argument starting with `-` where it takes none: it reads it as a flag. */
function unexpected(why: string, arg: string): Refusal {
  const long = arg.startsWith('--');
  const flag = long ? (arg.split('=')[0] ?? arg) : arg.slice(0, 2);
  return clap(why, `unexpected argument '${flag}' found`, { tip: `to pass '${flag}' as a value, use '-- ${flag}'`, usage: long ? 'tb-prod query <RESOURCE_TYPE>' : undefined });
}

/** tb-prod's JSON error (`json_error.rs`): exit 1, on stdout, keys in serde_json's sorted order. */
function jsonError(code: string, error: string, details?: unknown): Printed {
  return { stdout: `${JSON.stringify({ code, ...(details === undefined ? {} : { details }), error }, null, 2)}\n`, code: 1 };
}

/** `query tasks` and its options, as clap reads them: `--name value` or `--name=value`, in any order. */
function parse(argv: readonly string[]): Options | Refusal {
  if (argv[0] !== 'query') return refuse('only `query tasks` is answered');
  const opts: Options = {};
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') ? (eq < 0 ? arg : arg.slice(0, eq)).slice(2) : '';
    if (!isOption(name)) return unexpected(`tb-prod has no option ${arg}`, arg);
    let value: string;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && isOption(next.slice(2).split('=')[0] ?? ''))) {
        return clap(`--${name} has no value`, `a value is required for '${placeholder(name)}' but none was supplied`, { usage: null });
      }
      if (next.startsWith('-') && next !== '-') return unexpected(`clap reads \`${next}\`, the value of --${name}, as a flag: pass it as \`--${name}=${next}\``, next);
      value = next;
      i++;
    }
    if (opts[name] !== undefined) return clap(`--${name} is given twice`, `the argument '${placeholder(name)}' cannot be used multiple times`);
    if (name === 'page' && !/^\+?\d+$/.test(value)) {
      const why = value === '' ? 'cannot parse integer from empty string' : 'invalid digit found in string';
      return clap('--page is not a page number', `invalid value '${value}' for '${placeholder('page')}': ${why}`, { usage: null });
    }
    opts[name] = value;
  }
  if (positional.length > 1) return clap('it has an argument too many', `unexpected argument '${positional[1] ?? ''}' found`);
  if (positional[0] !== 'tasks') return refuse('only `query tasks` is answered');
  return opts;
}

/** The email of WORK's filter, or null for any other filter. */
function workAssignee(group: Group): string | null {
  if (group.op !== 'and' || group.conditions.length !== WORK_SCOPE.length + 1) return null;
  const conditions = group.conditions.filter((c): c is Condition => 'field' in c);
  const has = (w: Condition) => conditions.some((c) => c.field === w.field && c.operator === w.operator && c.value === w.value);
  if (!WORK_SCOPE.every(has)) return null;
  const assignee = conditions.find((c) => c.field === 'assignee.email' && c.operator === 'eq');
  return assignee && typeof assignee.value === 'string' && assignee.value !== '' ? assignee.value : null;
}

interface Query {
  email: string;
  page: number;
  includes: string[];
}

/** What tb-prod checks of a query (its filter), then whether the fake can answer it faithfully. */
function check(opts: Options): Query | Refusal {
  if (opts.filter === undefined) return refuse('it has no --filter, so it would read every Task in the organization');
  const filter = parseFilter(opts.filter);
  if ('invalidJson' in filter) return { refused: `tb-prod can't read its --filter (invalid_json): ${filter.invalidJson}`, outcome: jsonError('invalid_json', filter.invalidJson) };
  const errors = validateFilter(filter);
  const [first] = errors;
  if (first !== undefined) return { refused: `tb-prod rejects its --filter (invalid_filter): ${first}`, outcome: jsonError('invalid_filter', first, { errors }) };
  const email = workAssignee(filter);
  if (email === null) return refuse(`its --filter isn't WORK's (an \`and\` of ${WORK_FILTER}), so the fake can't tell which Tasks tb-prod would return`);
  // tb-prod's `tasks` has no default sort (schema.json, query.rs): without one, Productive picks the
  // order, which the fake can't tell.
  if (opts.sort === undefined) return refuse(`it has no --sort, so Productive would pick the order; WORK sorts by ${WORK_SORT}`);
  if (opts.sort !== WORK_SORT) return refuse(`it sorts by ${JSON.stringify(opts.sort)}; the fake answers only WORK's sort, ${WORK_SORT}`);
  const page = Number(opts.page ?? '1');
  if (page < 1) return refuse(`--page ${opts.page ?? ''}: pages start at 1`);
  const includes = (opts.include ?? '').split(',').filter(Boolean);
  const unknown = includes.find((i) => !INCLUDES.has(i));
  if (unknown) return refuse(`it can't include ${unknown}, only ${[...INCLUDES].join(' and ')}`);
  return { email, page, includes };
}

/** Ids for the declared projects and workflow statuses, stable for one declaration. */
function idsFor(decl: TbProdDecl): { project: (t: TaskDecl) => string; status: (t: TaskDecl) => string } {
  const projects = new Map<string, string>();
  const statuses = new Map<string, string>();
  for (const t of Object.values(decl.tasks ?? {}).flat()) {
    if (!projects.has(t.project)) projects.set(t.project, String(1001 + projects.size));
    const key = statusKey(t);
    if (!statuses.has(key)) statuses.set(key, String(2001 + statuses.size));
  }
  return { project: (t) => projects.get(t.project) ?? '', status: (t) => statuses.get(statusKey(t)) ?? '' };
}

const category = (t: TaskDecl) => t.statusCategory ?? 2;
const statusName = (t: TaskDecl) => t.status ?? (category(t) === 1 ? 'Not started' : 'In progress');
const statusKey = (t: TaskDecl) => `${category(t)}\n${statusName(t)}`;

function answer(argv: string[], decl: TbProdDecl): Outcome | Refusal {
  const opts = parse(argv);
  if ('refused' in opts) return opts;
  // tb-prod loads its config before it reads the filter (main.rs): without one, that's all it says.
  const query = check(opts);
  if ('refused' in query) return decl.failure === 'no-config' ? { refused: query.refused, outcome: NO_CONFIG } : query;

  switch (decl.failure) {
    case 'no-config':
      return NO_CONFIG;
    case 401:
    case 403: {
      const title = decl.failure === 401 ? 'Unauthorized' : 'Forbidden';
      const body = JSON.stringify({ errors: [{ status: String(decl.failure), title }] });
      return jsonError('api_error', `API error (${decl.failure})`, { body, status: decl.failure });
    }
    case 'timeout':
      return { hang: true };
  }

  const { email, page, includes } = query;
  // tb-prod passes WORK's sort to Productive, which answers the most recently active first (WORK-2.1).
  const at = (t: TaskDecl) => (t.lastActivityAt ? Date.parse(t.lastActivityAt) : -Infinity);
  const tasks = [...(decl.tasks?.[email] ?? [])].sort((a, b) => at(b) - at(a));
  const ids = idsFor(decl);
  const rows = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const included = new Map<string, unknown>();
  for (const t of rows) {
    if (includes.includes('project')) included.set(`p${ids.project(t)}`, { id: ids.project(t), type: 'projects', attributes: { name: t.project }, relationships: {} });
    if (includes.includes('workflow_status')) {
      included.set(`s${ids.status(t)}`, { id: ids.status(t), type: 'workflow_statuses', attributes: { name: statusName(t), category_id: category(t) }, relationships: {} });
    }
  }
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const out = {
    data: rows.map((t) => ({
      id: t.id,
      type: 'tasks',
      attributes: { title: t.title, description: t.description ?? null, due_date: t.dueDate ?? null, last_activity_at: t.lastActivityAt ?? null, type_id: t.milestone ? 3 : 1 },
      relationships: {
        project: { data: { type: 'projects', id: ids.project(t) } },
        workflow_status: { data: { type: 'workflow_statuses', id: ids.status(t) } },
      },
    })),
    included: [...included.values()],
    meta: { totalCount: tasks.length, totalPages, currentPage: page, hasNextPage: page < totalPages },
  };
  return { stdout: `${JSON.stringify(out, null, 2)}\n`, code: 0 };
}

await serveCall<TbProdDecl>('tb-prod', answer);
