// `pnpm req-check`: keeps the specs' acceptance criteria and the tests naming them in step (TEST-3).
// Criteria come from docs/features/*/SPEC.md, codes from docs/features/README.md, and test titles
// only from the runners' own listings: Vitest's (scripts/vitest-titles.mjs) and `playwright test --list`.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { parse as parseYaml } from 'yaml';

const PLAYWRIGHT_CONFIGS = ['e2e/playwright.config.ts', 'e2e/playwright.config.mjs', 'e2e/playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs', 'playwright.config.js'];
const VITEST_TITLES = fileURLToPath(new URL('./vitest-titles.mjs', import.meta.url));
const SEE = 'See docs/features/behaviour-tests/SPEC.md (TEST-3).';

/** The feature codes from the table in docs/features/README.md. Only these count as ids. */
export function parseCodes(readme) {
  const codes = [];
  for (const line of readme.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const code = cells[2];
    if (code && /^[A-Z][A-Z0-9]*$/.test(code)) codes.push(code);
  }
  return codes;
}

/** Splits off the YAML frontmatter and reads it. Invalid YAML fails with the spec's path. */
function frontmatter(text, file) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!m) return { fields: {}, body: text, lines: 0 };
  let fields;
  try {
    fields = parseYaml(m[1]);
  } catch (e) {
    throw new Error(`${file || 'a spec'} has frontmatter that isn't valid YAML: ${e.message.split('\n')[0]}`, { cause: e });
  }
  return { fields: fields && typeof fields === 'object' ? fields : {}, body: text.slice(m[0].length), lines: m[0].split('\n').length - 1 };
}

const field = (value) => (value == null ? '' : String(value).trim());

/** The text a reader sees in a node, without code: fenced, indented or inline code is never structure or a tag. */
function textOf(node) {
  if (node.type === 'text') return node.value;
  if (node.type === 'code' || node.type === 'inlineCode') return '';
  return (node.children ?? []).map(textOf).join('');
}

const CRITERION_ID = /^([A-Z][A-Z0-9]*-\d+\.\d+)\b/;
/** A criterion id after markup a writer may have left open, such as `~~`. */
const LOOKS_LIKE_ID = /^[~*_\s]*([A-Z][A-Z0-9]*-\d+\.\d+)\b/;
/** Why a task-list item inside one of these can't be a criterion. */
const INSIDE = { listItem: 'is nested in another list item', blockquote: 'is inside a blockquote', footnoteDefinition: 'is inside a footnote' };

/**
 * One SPEC.md, read as Markdown (CommonMark plus GFM): its requirements (top-level `### CODE-n` headings)
 * and the acceptance criteria under them (top-level GFM task-list items starting with `CODE-n.m`), each
 * with tag, tick and strike (`~~…~~` around the start). A task-list item anywhere else that starts with
 * a criterion id is a stray: it would otherwise drop out of the check without a word.
 */
export function parseSpec(text, file = '') {
  const { fields, body, lines } = frontmatter(text.replace(/\r\n?/g, '\n'), file);
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const requirements = [];
  // Only the items of these lists can be criteria: top-level lists under a requirement heading.
  const criterionLists = new Set();
  let inRequirement = false;
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth <= 3) {
      const req = node.depth === 3 && /^([A-Z][A-Z0-9]*-\d+)\b/.exec(textOf(node));
      inRequirement = Boolean(req);
      if (req) requirements.push({ id: req[1], struck: node.children[0]?.type === 'delete' });
    } else if (inRequirement && node.type === 'list') criterionLists.add(node);
  }
  const criteria = [];
  const strays = [];
  const visit = (node, ancestors) => {
    const first = node.type === 'listItem' && typeof node.checked === 'boolean' && node.children[0];
    const lead = first?.type === 'paragraph' ? textOf(first) : '';
    const looks = LOOKS_LIKE_ID.exec(lead);
    if (looks) {
      const container = ancestors.findLast((a) => Object.hasOwn(INSIDE, a.type));
      const id = CRITERION_ID.exec(lead);
      let reason = null;
      if (container) reason = INSIDE[container.type];
      else if (!criterionLists.has(ancestors.at(-1))) reason = "isn't under a `### <CODE>-n` requirement heading";
      else if (!id) reason = lead.trimStart().startsWith('~') ? 'starts with a `~~` that never closes' : 'starts with markup that never closes';
      if (reason) strays.push({ id: looks[1], line: node.position.start.line + lines, reason });
      else {
        // The tag comes from the item's own paragraphs: not from a nested item, and not from code.
        const own = node.children.filter((c) => c.type === 'paragraph').map(textOf).join('\n');
        const tags = [...own.matchAll(/\((test|e2e|manual)\)/g)];
        criteria.push({ id: id[1], ticked: node.checked, struck: first.children[0]?.type === 'delete', tag: tags.length ? tags[tags.length - 1][1] : null });
      }
    }
    for (const child of node.children ?? []) visit(child, [...ancestors, node]);
  };
  visit(tree, []);
  return { code: field(fields.code) || null, title: field(fields.title), status: field(fields.status), file, requirements, criteria, strays };
}

/** Titles from scripts/vitest-titles.mjs: `{ path: ['describe', 'test'], file }[]`. Not Behaviour tests. */
export function titlesFromVitest(list, root = '') {
  return list.map((t) => ({ path: t.path, file: root ? relative(root, t.file) : t.file, behaviour: false }));
}

/**
 * A Playwright test that won't run (`test.skip`, `test.fixme`): expected to be skipped, or every
 * result it has was skipped. Like Vitest's skipped tests, it names no criterion.
 */
function skipped(spec) {
  const tests = spec.tests ?? [];
  return tests.length > 0 && tests.every((t) => t.expectedStatus === 'skipped' || (t.results?.length > 0 && t.results.every((r) => r.status === 'skipped')));
}

/** Titles from `playwright test --list --reporter=json`. Every one is a Behaviour test. */
export function titlesFromPlaywright(report) {
  const out = [];
  const walk = (suite, path, file) => {
    for (const spec of suite.specs ?? []) if (!skipped(spec)) out.push({ path: [...path, spec.title], file, behaviour: true });
    // An unnamed `describe` (as `scenario()` makes) adds nothing to the path.
    for (const child of suite.suites ?? []) walk(child, child.title ? [...path, child.title] : path, file);
  };
  // Top-level suites are the test files; their titles are paths, not describe titles. A test
  // belongs to the file it is in, even when a helper such as `scenario()` declares it.
  for (const top of report.suites ?? []) walk(top, [], top.file ?? top.title ?? '');
  return out;
}

/** The ids a title names (at the start of a test or describe title) and the ones it only mentions. */
export function idsIn(path, codes) {
  if (!codes.length) return { named: [], mentioned: [] };
  const alt = codes.join('|');
  const start = new RegExp(`^(?:${alt})-\\d+(?:\\.\\d+)?(?![\\d.]*\\d)`);
  const any = new RegExp(`\\b(?:${alt})-\\d+(?:\\.\\d+)?(?![\\d.]*\\d)`, 'g');
  const named = new Set();
  const mentioned = new Set();
  for (const segment of path) {
    const title = segment.trim();
    const first = start.exec(title)?.[0];
    if (first) named.add(first);
    for (const m of title.matchAll(any)) if (m[0] !== first || m.index !== 0) mentioned.add(m[0]);
  }
  for (const id of named) mentioned.delete(id);
  return { named: [...named], mentioned: [...mentioned] };
}

/** Applies the rules of TEST-3.2 to TEST-3.5. */
export function check({ codes, specs, tests, behaviourRead = true }) {
  const known = new Map();
  for (const spec of specs) {
    for (const r of spec.requirements) known.set(r.id, { kind: 'requirement', struck: r.struck });
    for (const c of spec.criteria) known.set(c.id, { kind: 'criterion', struck: c.struck });
  }
  const naming = new Map();
  const mentioning = new Map();
  const violations = [];
  for (const t of tests) {
    const { named, mentioned } = idsIn(t.path, codes);
    for (const id of named) {
      const k = known.get(id);
      if (!k || k.struck) {
        violations.push({ rule: 'TEST-3.4', id, code: id.split('-')[0], file: t.file, title: t.path.join(' > '), message: `${t.file} names ${id}, ${k ? 'which is struck through' : 'which no spec has'}` });
        continue;
      }
      if (!naming.has(id)) naming.set(id, []);
      naming.get(id).push(t);
    }
    for (const id of mentioned) {
      if (!mentioning.has(id)) mentioning.set(id, []);
      mentioning.get(id).push(t);
    }
  }
  for (const spec of specs) {
    for (const s of spec.strays) violations.push({ rule: 'TEST-3.1', id: s.id, code: spec.code, message: `${spec.file}:${s.line}: ${s.id} ${s.reason}, so it isn't read as a criterion` });
  }
  const info = [];
  const features = specs.map((spec) => ({
    code: spec.code,
    title: spec.title,
    status: spec.status,
    file: spec.file,
    criteria: spec.criteria.map((c) => {
      const named = naming.get(c.id) ?? [];
      const row = {
        id: c.id,
        tag: c.tag,
        ticked: c.ticked,
        struck: c.struck,
        tests: named.map((t) => ({ file: t.file, title: t.path.join(' > '), behaviour: t.behaviour })),
        mentions: (mentioning.get(c.id) ?? []).map((t) => ({ file: t.file, title: t.path.join(' > '), behaviour: t.behaviour })),
        violation: null,
        info: null,
      };
      if (!c.struck && c.ticked && !c.tag) row.violation = 'no tag';
      else if (!c.struck && c.ticked && c.tag === 'test' && named.length === 0) row.violation = 'no test';
      else if (!c.struck && c.ticked && c.tag === 'e2e' && !named.some((t) => t.behaviour)) row.violation = 'no Behaviour test';
      else if (!c.struck && c.tag === 'manual' && named.length > 0) row.info = 'manual, tested anyway';
      else if (!c.struck && !c.ticked && named.length > 0) row.info = 'open, already tested';
      if (row.violation === 'no tag') violations.push({ rule: 'TEST-3.1', id: c.id, code: spec.code, message: `${spec.file}: ${c.id} is ticked but has no (test), (e2e) or (manual) tag outside code` });
      else if (row.violation) violations.push({ rule: c.tag === 'e2e' ? 'TEST-3.3' : 'TEST-3.2', id: c.id, code: spec.code, message: `${c.id} is ticked (${c.tag}) but has ${row.violation === 'no test' ? 'no test naming it' : 'no Behaviour test naming it'}` });
      if (row.info) info.push({ id: c.id, code: spec.code, message: `${c.id}: ${row.info}` });
      return row;
    }),
  }));
  const notes = behaviourRead ? [] : ['No Playwright config, so no Behaviour tests were read.'];
  return { ok: violations.length === 0, features, violations, info, notes };
}

/** Narrows a report to one feature (`--feature <CODE>`). */
export function narrow(report, code) {
  const features = report.features.filter((f) => f.code === code);
  const violations = report.violations.filter((v) => v.code === code);
  return { ...report, ok: violations.length === 0, features, violations, info: report.info.filter((i) => i.code === code) };
}

function summarize(tests) {
  const counts = new Map();
  for (const t of tests) counts.set(basename(t.file), (counts.get(basename(t.file)) ?? 0) + 1);
  return [...counts].map(([file, n]) => `${file} ×${n}`).join(', ');
}

/** The human-readable report (TEST-3.6). */
export function format(report) {
  const lines = [];
  for (const f of report.features) {
    lines.push(`${f.code}  ${f.title} (${f.status})`);
    const width = Math.max(0, ...f.criteria.map((c) => c.id.length));
    for (const c of f.criteria) {
      const mark = c.violation ? '✗' : c.struck ? '–' : c.ticked ? '✓' : '·';
      const tag = `(${c.tag ?? 'no tag'})`.padEnd(9);
      const state = (c.struck ? 'struck' : c.ticked ? 'ticked' : 'open').padEnd(7);
      let tests = c.violation ?? (summarize(c.tests) || 'no tests');
      if (c.violation && c.tests.length) tests += ` (${summarize(c.tests)})`;
      if (c.mentions.length) tests += `; mentioned in ${summarize(c.mentions)}`;
      if (c.info) tests += ` (info: ${c.info})`;
      lines.push(`  ${mark} ${c.id.padEnd(width)} ${tag} ${state} ${tests}`);
    }
    lines.push('');
  }
  for (const note of report.notes) lines.push(`Info: ${note}`);
  if (report.info.length) {
    lines.push(`Info (${report.info.length}, not failures):`);
    for (const i of report.info) lines.push(`  ${i.message}`);
  }
  if (report.violations.length) {
    lines.push('Violations:');
    for (const v of report.violations) lines.push(`  ✗ ${v.message} (${v.rule})${v.title ? `: "${v.title}"` : ''}`);
  }
  const n = report.violations.length;
  lines.push(n ? `${n} violation${n === 1 ? '' : 's'}. ${SEE}` : 'No violations.');
  return lines.join('\n');
}

function runJson(root, args, what) {
  const r = spawnSync('pnpm', ['exec', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${what} failed (exit ${r.status ?? r.error?.message}):\n${r.stderr || r.stdout}`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`${what} didn't print JSON:\n${r.stdout.slice(0, 500)}`);
  }
}

/** Reads the specs and the runners' listings under `root`. The listings can be replaced in tests. */
export function collect(root, listings = {}) {
  const featuresDir = join(root, 'docs/features');
  const codes = parseCodes(readFileSync(join(featuresDir, 'README.md'), 'utf8'));
  const specs = readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(featuresDir, d.name, 'SPEC.md')))
    .map((d) => d.name)
    .sort()
    .map((name) => parseSpec(readFileSync(join(featuresDir, name, 'SPEC.md'), 'utf8'), `docs/features/${name}/SPEC.md`));
  const unread = specs.find((s) => !s.code);
  if (unread) throw new Error(`${unread.file} has no \`code:\` in its frontmatter, so its criteria can't be checked.`);
  specs.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));

  const vitest = listings.vitest ? listings.vitest() : runJson(root, ['node', VITEST_TITLES], '`node scripts/vitest-titles.mjs`');
  const config = PLAYWRIGHT_CONFIGS.find((c) => existsSync(join(root, c)));
  let playwright = null;
  if (listings.playwright) playwright = listings.playwright();
  else if (config) playwright = runJson(root, ['playwright', 'test', '--config', config, '--list', '--reporter=json'], '`playwright test --list`');
  if (playwright?.errors?.length) throw new Error(`\`playwright test --list\` reported errors:\n${playwright.errors.map((e) => e.message).join('\n')}`);

  const tests = [...titlesFromVitest(vitest, root), ...(playwright ? titlesFromPlaywright(playwright) : [])];
  return { codes, specs, tests, behaviourRead: Boolean(playwright) };
}

/** The CLI. Returns the exit code: 0 when there's no violation, 1 otherwise. */
export function main(argv, { root = process.cwd(), listings, out = console.log, err = console.error } = {}) {
  const json = argv.includes('--json');
  const at = argv.indexOf('--feature');
  const feature = at >= 0 ? argv[at + 1] : null;
  if (at >= 0 && !feature) {
    err('req-check: --feature needs a code, e.g. --feature USAGE');
    return 1;
  }
  let report;
  try {
    report = check(collect(root, listings));
  } catch (e) {
    err(`req-check: ${e.message}`);
    return 1;
  }
  if (feature) {
    if (!report.features.some((f) => f.code === feature)) {
      err(`req-check: no feature ${feature}. Codes: ${report.features.map((f) => f.code).join(', ')}`);
      return 1;
    }
    report = narrow(report, feature);
  }
  out(json ? JSON.stringify(report, null, 2) : format(report));
  return report.ok ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
