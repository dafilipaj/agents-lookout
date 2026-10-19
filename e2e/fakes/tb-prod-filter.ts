/**
 * tb-prod's filter check (`crates/tb-prod/src/filter.rs`), for the fake `tb-prod` to refuse a filter
 * where tb-prod does, in tb-prod's words: the `--filter` JSON read as serde reads its `FilterInput`,
 * normalized, then each condition checked as `validate_condition` checks it, against a slice of
 * tb-prod's schema (`schema.json` 1.1.0, in tb-prod 1.2.0, cli-toolbox d91e580).
 *
 * The slice only decides how the fake refuses a filter, never what it answers: it answers WORK's
 * filter alone (tb-prod.ts). So a slice gone stale can change an error's text, never let a filter
 * through.
 */

export interface Condition {
  field: string;
  operator: string;
  value: string | string[];
}

export interface Group {
  op: string;
  conditions: (Condition | Group)[];
}

/** A field's type: `<primitive>`, or `enum <name>` or `resource <type>` (`TypeCategory`). */
type FieldType = string;

/** The `tasks` resource's filter keys, in schema order. */
const TASKS: Readonly<Record<string, FieldType>> = {
  title: 'string',
  description: 'string',
  task_number: 'string',
  type_id: 'enum task_type',
  task_type: 'enum task_parent_type',
  start_date: 'date',
  due_date: 'date',
  public_access: 'boolean',
  created_at: 'date',
  closed_at: 'date',
  repeating: 'boolean',
  tags: 'string',
  initial_estimate: 'number',
  remaining_time: 'number',
  worked_time: 'number',
  custom_fields: 'hash',
  assignee_id: 'resource people',
  creator_id: 'resource people',
  task_list_id: 'resource task_lists',
  project_id: 'resource projects',
  parent_task_id: 'resource tasks',
  service_id: 'resource services',
  workflow_status_id: 'resource workflow_statuses',
  workflow_status_category_id: 'enum workflow_status_category',
  task_list_status: 'enum archivable_status',
  task_list_name: 'string',
  folder_status: 'enum archivable_status',
  folder_name: 'string',
  template_id: 'string',
  subscriber_id: 'string',
  last_activity: 'date',
};

/** The relationships a `tasks` filter can go through (`project.status`), and the resource each reaches. */
const TASK_RELATIONSHIPS: Readonly<Record<string, string>> = {
  repeated_task: 'tasks',
  assignee: 'people',
  creator: 'people',
  task_list: 'task_lists',
  project: 'projects',
  parent_task: 'tasks',
  service: 'services',
  workflow_status: 'workflow_statuses',
  attachments: 'attachments',
};

/** The filter keys of the resources WORK filters Tasks through. Others aren't in the slice. */
const RELATED: Readonly<Record<string, Readonly<Record<string, FieldType>>>> = {
  tasks: TASKS,
  people: {
    first_name: 'string',
    last_name: 'string',
    email: 'string',
    title: 'string',
    agent: 'boolean',
    last_seen_at: 'date',
    person_type: 'enum person_type',
    status: 'enum person_status',
    project_watching: 'resource projects',
    accessible_project_id: 'resource projects',
    accessible_deal_id: 'resource deals',
    subscribable_type: 'enum subscribable_type',
    subscribable_id: 'string',
    archived_at: 'date',
    deactivated_at: 'date',
    virtual: 'boolean',
    joined_at: 'date',
    custom_fields: 'hash',
    manager_id: 'resource people',
    custom_role_id: 'resource roles',
    job_role_id: 'resource job_roles',
    company_id: 'resource companies',
    subsidiary_id: 'resource subsidiaries',
    time_tracking_policy_id: 'resource time_tracking_policies',
    team: 'resource teams',
    autotracking: 'boolean',
  },
  projects: {
    name: 'string',
    project_number: 'string',
    created_at: 'date',
    archived_at: 'date',
    project_color: 'enum color',
    status: 'enum archivable_status',
    person_id: 'resource people',
    custom_fields: 'hash',
    project_type: 'enum project_type',
    company_id: 'resource companies',
    responsible_id: 'resource people',
    workflow_id: 'resource workflows',
  },
};

/** `operators_for_field` (schema.rs). */
function operators(type: FieldType): readonly string[] {
  if (type.startsWith('resource ')) return ['eq', 'not_eq', 'any_of', 'none_of'];
  if (type.startsWith('enum ')) return ['eq', 'not_eq'];
  if (type === 'date' || type === 'number') return ['eq', 'not_eq', 'gt', 'lt', 'gt_eq', 'lt_eq'];
  if (type === 'boolean') return ['eq'];
  if (type === 'string') return ['eq', 'not_eq', 'contains', 'not_contain'];
  return ['eq', 'not_eq'];
}

/** The type's name, as `FieldDef.field_type` gives it in an error. */
const typeName = (type: FieldType) => type.split(' ').at(-1) ?? type;
/** Rust's `{:?}` of a `&[&str]`. */
const debugList = (xs: readonly string[]) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function asCondition(v: unknown): Condition | null {
  if (!isObject(v) || typeof v.field !== 'string') return null;
  // `op` is an alias of `operator`: serde takes one, and refuses both as a duplicate field.
  if (('operator' in v) === ('op' in v)) return null;
  const operator = v.operator ?? v.op;
  const value = v.value;
  if (typeof operator !== 'string') return null;
  if (typeof value === 'string' || (Array.isArray(value) && value.every((x) => typeof x === 'string'))) return { field: v.field, operator, value };
  return null;
}

function asGroup(v: unknown): Group | null {
  if (!isObject(v) || typeof v.op !== 'string' || !Array.isArray(v.conditions)) return null;
  const conditions: (Condition | Group)[] = [];
  for (const entry of v.conditions) {
    const parsed = asCondition(entry) ?? asGroup(entry);
    if (!parsed) return null;
    conditions.push(parsed);
  }
  return { op: v.op, conditions };
}

/** A value of a flat filter, as `normalize_filter` turns it into text. */
const flatText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v).replace(/^"+|"+$/g, ''));

/**
 * `--filter` as tb-prod reads it: a FilterGroup, or else any JSON object as a flat filter, whose
 * keys (in serde_json's sorted order) become `eq` conditions. So a group serde can't read, say one
 * with a number for a value, is read as a flat filter on the fields `conditions` and `op`.
 */
export function parseFilter(text: string): Group | { invalidJson: string } {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (e) {
    // serde_json words a syntax error its own way; the code and the exit are tb-prod's.
    return { invalidJson: `Invalid filter JSON: ${(e as Error).message}` };
  }
  const group = asGroup(input);
  if (group) return group;
  if (!isObject(input)) return { invalidJson: 'Invalid filter JSON: data did not match any variant of untagged enum FilterInput' };
  const conditions = Object.keys(input)
    .sort()
    .map((field) => {
      const v = input[field];
      return { field, operator: 'eq', value: Array.isArray(v) ? v.map(flatText) : flatText(v) };
    });
  return { op: 'and', conditions };
}

/** `validate_filter_group` on `tasks`: every error, in tb-prod's order and words. */
export function validateFilter(group: Group): string[] {
  const errors: string[] = [];
  if (group.op !== 'and' && group.op !== 'or') errors.push(`Invalid filter operator '${group.op}'. Must be 'and' or 'or'.`);
  for (const entry of group.conditions) errors.push(...('field' in entry ? validateCondition(entry) : validateFilter(entry)));
  return errors;
}

function validateCondition(c: Condition): string[] {
  const dot = c.field.indexOf('.');
  if (dot >= 0) {
    const rel = c.field.slice(0, dot);
    const sub = c.field.slice(dot + 1);
    const related = TASK_RELATIONSHIPS[rel];
    if (related === undefined) return [`Unknown relationship '${rel}' on tasks.`];
    const fields = RELATED[related];
    // Outside the slice: the fake can't tell, and refuses the filter as not WORK's.
    if (fields === undefined) return [];
    const type = fields[sub];
    if (type === undefined) return [`Unknown filter field '${sub}' on related resource ${related}.`];
    const ops = operators(type);
    return ops.includes(c.operator) ? [] : [`Invalid operator '${c.operator}' for ${rel}.${sub}. Valid: ${debugList(ops)}`];
  }
  const type = TASKS[c.field];
  // tb-prod lists them in its HashMap's order, which changes from run to run.
  if (type === undefined) return [`Unknown filter field '${c.field}' on tasks. Available: ${Object.keys(TASKS).join(', ')}`];
  const ops = operators(type);
  return ops.includes(c.operator) ? [] : [`Invalid operator '${c.operator}' for field '${c.field}' (${typeName(type)}). Valid: ${debugList(ops)}`];
}
