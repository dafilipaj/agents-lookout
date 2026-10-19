import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { check, collect, main, parseCodes, parseSpec, titlesFromPlaywright, titlesFromVitest } from './req-check.mjs';

const root = fileURLToPath(new URL('./fixtures/req-check', import.meta.url));
const strays = fileURLToPath(new URL('./fixtures/req-check-strays', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

/** A scripts/vitest-titles.mjs entry: a test title, or its describe titles and its title. */
const unit = (path, file = 'server/demo.test.ts') => ({ path: [path].flat(), file: `${root}/${file}` });

/** A `playwright test --list --reporter=json` report with one file of Behaviour tests. */
const behaviour = (...titles) => ({
  suites: [{ title: 'scenarios/demo/demo.e2e.ts', file: 'scenarios/demo/demo.e2e.ts', specs: titles.map((title) => ({ title, file: 'scenarios/demo/demo.e2e.ts' })), suites: [] }],
  errors: [],
});

/** Units that satisfy every ticked DEMO criterion except the ones a test leaves out on purpose. */
const baseUnits = [
  unit('DEMO-1.1: ticked and tested'),
  unit('DEMO-1.4: a unit test of an e2e criterion'),
  unit('DEMO-1.5: tested anyway'),
  unit('DEMO-1.6: tested before it is ticked'),
  unit('DEMO-2.1: spans lines'),
  unit('DEMO-4.1: after the fences'),
];

function run({ units = baseUnits, e2e = behaviour('DEMO-1.3: holds end to end') } = {}) {
  return check(collect(root, { vitest: () => units, playwright: e2e === null ? undefined : () => e2e }));
}

const row = (report, id) => report.features.flatMap((f) => f.criteria).find((c) => c.id === id);
const failing = (report) => report.violations.map((v) => v.id).sort();

describe('req-check', () => {
  it('TEST-3.1: reads each criterion\'s id, tag, tick and strike, only under requirement headings', () => {
    const { codes, specs } = collect(root, { vitest: () => [] });
    expect(codes).toEqual(['DEMO', 'OTHER', 'LATER']);
    expect(specs.map((s) => s.code)).toEqual(['DEMO', 'OTHER']);
    const demo = specs[0];
    expect(demo.criteria.map((c) => c.id)).toEqual(['DEMO-1.1', 'DEMO-1.2', 'DEMO-1.3', 'DEMO-1.4', 'DEMO-1.5', 'DEMO-1.6', 'DEMO-1.7', 'DEMO-1.8', 'DEMO-1.9', 'DEMO-2.1', 'DEMO-2.2', 'DEMO-3.1', 'DEMO-4.1', 'DEMO-4.2']);
    const byId = Object.fromEntries(demo.criteria.map((c) => [c.id, c]));
    expect(byId['DEMO-1.1']).toMatchObject({ tag: 'test', ticked: true, struck: false });
    expect(byId['DEMO-1.3']).toMatchObject({ tag: 'e2e', ticked: true });
    expect(byId['DEMO-1.5']).toMatchObject({ tag: 'manual', ticked: true });
    expect(byId['DEMO-1.7']).toMatchObject({ tag: 'test', ticked: false });
    expect(byId['DEMO-1.9']).toMatchObject({ struck: true });
    expect(byId['DEMO-2.1']).toMatchObject({ tag: 'test', ticked: true });
    expect(byId['DEMO-2.2']).toMatchObject({ tag: null });
    expect(demo.requirements).toEqual([
      { id: 'DEMO-1', struck: false },
      { id: 'DEMO-2', struck: false },
      { id: 'DEMO-3', struck: true },
      { id: 'DEMO-4', struck: false },
    ]);
  });

  it('TEST-3.1: fenced code is never spec structure: not a heading, a criterion or a tag', () => {
    const demo = collect(root, { vitest: () => [] }).specs[0];
    expect(demo.criteria.filter((c) => c.id.startsWith('DEMO-4.'))).toEqual([
      { id: 'DEMO-4.1', tag: 'test', ticked: true, struck: false },
      { id: 'DEMO-4.2', tag: 'test', ticked: false, struck: false },
    ]);
    // A ticked criterion after a fenced heading is still checked.
    const report = run({ units: baseUnits.filter((u) => u.path[0] !== 'DEMO-4.1: after the fences') });
    expect(row(report, 'DEMO-4.1').violation).toBe('no test');
  });

  it('TEST-3.1: what only looks like a fence never hides the criteria after it', () => {
    const spec = (requirement) => parseSpec(`---\ncode: X\n---\n## Requirements\n\n### X-1 One\n\n${requirement}- [x] X-1.2 After it. (test)\n`).criteria;
    const after = { id: 'X-1.2', tag: 'test', ticked: true, struck: false };
    // A fence left open inside a criterion ends with that criterion.
    expect(spec('- [x] X-1.1 Holds. (test)\n  ```\n  never closed (manual)\n')).toEqual([{ id: 'X-1.1', tag: 'test', ticked: true, struck: false }, after]);
    // Backticks closed on the same line are inline code, not a fence.
    expect(spec('```inline```\n\n')).toEqual([after]);
    // Backticks indented four spaces outside a list are an indented code block, not a fence.
    expect(spec('    ```\n\n')).toEqual([after]);
  });

  it('TEST-3.1: reads CRLF specs and the frontmatter as YAML, comments and quotes included', () => {
    const spec = parseSpec('---\r\ntitle: "Search # tags" # the name\r\ncode: X          # 3–6 capital letters\r\nstatus: Draft  # Draft | Ready\r\n---\r\n\r\n## Requirements\r\n\r\n### X-1 One\r\n\r\n- [x] X-1.1 Holds. (test)\r\n');
    expect(spec).toMatchObject({ code: 'X', title: 'Search # tags', status: 'Draft' });
    expect(spec.criteria).toEqual([{ id: 'X-1.1', tag: 'test', ticked: true, struck: false }]);
    // The OTHER fixture's frontmatter carries the template's comments.
    expect(collect(root, { vitest: () => [] }).specs[1]).toMatchObject({ code: 'OTHER', status: 'Ready' });
    expect(() => parseSpec('---\ncode: [X\n---\n', 'docs/features/x/SPEC.md')).toThrow(/^docs\/features\/x\/SPEC\.md has frontmatter that isn't valid YAML/);
  });

  it('TEST-3.1: a spec whose frontmatter has no code fails with its path instead of being skipped', () => {
    const err = [];
    const unreadable = fileURLToPath(new URL('./fixtures/req-check-unreadable', import.meta.url));
    expect(main([], { root: unreadable, listings: { vitest: () => [] }, out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('\n')).toMatch(/docs\/features\/draft\/SPEC\.md has no `code:` in its frontmatter/);
  });

  it.each([
    ['nested in another item', 'ODD-1.2', 'docs/features/odd/SPEC.md:14: ODD-1.2 is nested in another list item, so it isn\'t read as a criterion'],
    ['inside a blockquote', 'ODD-1.3', 'docs/features/odd/SPEC.md:16: ODD-1.3 is inside a blockquote, so it isn\'t read as a criterion'],
    ['struck with a ~~ that never closes', 'ODD-1.4', 'docs/features/odd/SPEC.md:18: ODD-1.4 starts with a `~~` that never closes, so it isn\'t read as a criterion'],
    ['outside a requirement', 'ODD-9.9', 'docs/features/odd/SPEC.md:25: ODD-9.9 isn\'t under a `### <CODE>-n` requirement heading, so it isn\'t read as a criterion'],
    ['ticked, with its tag only in inline code', 'ODD-1.5', 'docs/features/odd/SPEC.md: ODD-1.5 is ticked but has no (test), (e2e) or (manual) tag outside code'],
    ['ticked, with no tag', 'ODD-1.6', 'docs/features/odd/SPEC.md: ODD-1.6 is ticked but has no (test), (e2e) or (manual) tag outside code'],
  ])('TEST-3.1: a task-list item starting with an id fails when it is %s', (_, id, message) => {
    const report = check(collect(strays, { vitest: () => [unit('ODD-1.1: holds')] }));
    expect(report.violations.filter((v) => v.id === id)).toEqual([{ rule: 'TEST-3.1', id, code: 'ODD', message }]);
    // The rest of the spec is still read; nothing else fails.
    expect(failing(report)).toEqual(['ODD-1.2', 'ODD-1.3', 'ODD-1.4', 'ODD-1.5', 'ODD-1.6', 'ODD-9.9']);
  });

  it('TEST-3.1: a criterion\'s tag comes from its own paragraphs, not from a nested item or inline code', () => {
    const report = check(collect(strays, { vitest: () => [unit('ODD-1.1: holds')] }));
    expect(row(report, 'ODD-1.1')).toMatchObject({ tag: 'test', ticked: true, violation: null });
    expect(row(report, 'ODD-1.5')).toMatchObject({ tag: null, violation: 'no tag' });
    // An open criterion without a tag is still being written.
    expect(row(report, 'ODD-1.7')).toMatchObject({ tag: null, ticked: false, violation: null });
    expect(report.features[0].criteria.map((c) => c.id)).toEqual(['ODD-1.1', 'ODD-1.5', 'ODD-1.6', 'ODD-1.7']);
  });

  it('TEST-3.1: the spec template\'s frontmatter is valid YAML once filled in, even with ": ", a backtick or "@" in the title', () => {
    const title = '`@lookout` Session view: messages';
    const template = readFileSync(join(repo, 'docs/templates/feature-spec.md'), 'utf8');
    const filled = template.replaceAll('<Feature name>', title).replaceAll('<CODE>', 'NEW').replaceAll('YYYY-MM-DD', '2026-10-17');
    const spec = parseSpec(filled, 'docs/features/new/SPEC.md');
    expect(spec).toMatchObject({ code: 'NEW', title, status: 'Draft', strays: [] });
    expect(spec.criteria.map((c) => c.id)).toEqual(['NEW-1.1', 'NEW-1.2', 'NEW-1.3', 'NEW-2.1']);
    // Left unquoted, the same title isn't YAML, and req-check fails with the spec's path.
    expect(() => parseSpec(filled.replace(`"${title}"`, title), 'docs/features/new/SPEC.md')).toThrow(/^docs\/features\/new\/SPEC\.md has frontmatter that isn't valid YAML/);
  });

  it('TEST-3.1: reads only codes from the features table', () => {
    expect(parseCodes('| Feature | Code | Status | Spec |\n|---|---|---|---|\n| X | SIDE | Ready | — |\n')).toEqual(['SIDE']);
    expect(parseSpec('---\ncode: X\n---\n## Open questions\n- [ ] Does X-1.1 hold? Not a criterion. (test)\n')).toMatchObject({ criteria: [], strays: [] });
  });

  it('TEST-3.1: reads test titles from the Vitest and Playwright listings, describe titles included', () => {
    expect(titlesFromVitest([unit(['switching', 'SIDE-4.2: in the URL'])], root)).toEqual([
      { path: ['switching', 'SIDE-4.2: in the URL'], file: 'server/demo.test.ts', behaviour: false },
    ]);
    const report = { suites: [{ title: 'a.e2e.ts', file: 'a.e2e.ts', specs: [{ title: 'USAGE-2.2: not installed', file: 'a.e2e.ts' }], suites: [{ title: 'USAGE-1', specs: [{ title: 'refreshes', file: 'a.e2e.ts' }] }] }] };
    expect(titlesFromPlaywright(report)).toEqual([
      { path: ['USAGE-2.2: not installed'], file: 'a.e2e.ts', behaviour: true },
      { path: ['USAGE-1', 'refreshes'], file: 'a.e2e.ts', behaviour: true },
    ]);
  });

  it("TEST-3.1: a Behaviour test declared through a helper belongs to its scenario file, not the helper's", () => {
    // `scenario()` calls `test()` inside an unnamed describe in e2e/world/index.ts; Playwright
    // reports that file as the spec's own.
    const report = {
      suites: [
        {
          title: 'side/fleet-missing.e2e.ts',
          file: 'side/fleet-missing.e2e.ts',
          specs: [],
          suites: [{ title: '', file: '../world/index.ts', specs: [{ title: 'SIDE-6.1: without Fleet', file: '../world/index.ts', tests: [{ expectedStatus: 'passed', results: [] }] }] }],
        },
      ],
    };
    expect(titlesFromPlaywright(report)).toEqual([{ path: ['SIDE-6.1: without Fleet'], file: 'side/fleet-missing.e2e.ts', behaviour: true }]);
  });

  it('TEST-3.3: a skipped Behaviour test (test.skip, test.fixme) does not count for a ticked (e2e) criterion', () => {
    const spec = (title, tests) => ({ title, file: 'scenarios/demo/demo.e2e.ts', tests });
    const listed = (...specs) => ({ suites: [{ title: 'scenarios/demo/demo.e2e.ts', file: 'scenarios/demo/demo.e2e.ts', specs, suites: [] }], errors: [] });
    // As `--list` reports test.fixme and test.skip: expected to be skipped.
    const fixme = run({ e2e: listed(spec('DEMO-1.3: holds end to end', [{ expectedStatus: 'skipped', results: [] }])) });
    expect(row(fixme, 'DEMO-1.3').violation).toBe('no Behaviour test');
    expect(fixme.violations.find((v) => v.id === 'DEMO-1.3')).toMatchObject({ rule: 'TEST-3.3' });
    // A report from a run, where every result was skipped (`test.skip()` called in the body).
    const ranSkipped = run({ e2e: listed(spec('DEMO-1.3: holds end to end', [{ expectedStatus: 'passed', results: [{ status: 'skipped' }] }])) });
    expect(row(ranSkipped, 'DEMO-1.3').violation).toBe('no Behaviour test');
    // One that runs still counts, next to a skipped one.
    const both = run({
      e2e: listed(spec('DEMO-1.3: holds end to end', [{ expectedStatus: 'skipped', results: [] }]), spec('DEMO-1.3: also holds', [{ expectedStatus: 'passed', results: [] }])),
    });
    expect(row(both, 'DEMO-1.3').violation).toBeNull();
    expect(row(both, 'DEMO-1.3').tests.map((t) => t.title)).toEqual(['DEMO-1.3: also holds']);
  });

  it('TEST-3.1: a Vitest title that contains " > " stays one title > DEMO-1.2: so this is only a mention', () => {
    const r = spawnSync(process.execPath, ['scripts/vitest-titles.mjs', 'scripts/req-check.test.mjs'], { cwd: repo, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const self = JSON.parse(r.stdout).find((t) => t.path.at(-1).includes(' > DEMO-1.2: '));
    expect(self.path).toEqual(['req-check', expect.stringMatching(/^TEST-3\.1: a Vitest title/)]);
    const report = check(collect(root, { vitest: () => [...baseUnits, self] }));
    expect(row(report, 'DEMO-1.2').violation).toBe('no test');
    expect(row(report, 'DEMO-1.2').mentions).toHaveLength(1);
  });

  it('TEST-3.1: Vitest titles come from collecting the files without running them: it.each expands, an unregistered test is absent', () => {
    const fixture = fileURLToPath(new URL('./fixtures/vitest-titles', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'lookout-vitest-titles-'));
    try {
      const ran = join(dir, 'ran');
      const r = spawnSync(process.execPath, [join(repo, 'scripts/vitest-titles.mjs')], { cwd: fixture, env: { ...process.env, TITLES_RAN: ran }, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual([
        { path: ['VIEW-1', 'VIEW-1.1: works'], file: join(fixture, 'titles.spec.mjs') },
        { path: ['VIEW-1', 'VIEW-1.2: works'], file: join(fixture, 'titles.spec.mjs') },
      ]);
      expect(existsSync(ran)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TEST-3.1: without a Playwright config it reads no Behaviour tests and says so', () => {
    const report = check(collect(root, { vitest: () => baseUnits }));
    expect(report.notes).toEqual(['No Playwright config, so no Behaviour tests were read.']);
    expect(report.features.flatMap((f) => f.criteria).flatMap((c) => c.tests).every((t) => !t.behaviour)).toBe(true);
  });

  it('TEST-3.2: fails when a ticked (test) criterion has no test naming it', () => {
    const report = run();
    expect(row(report, 'DEMO-1.2').violation).toBe('no test');
    expect(row(report, 'OTHER-1.1').violation).toBe('no test');
    expect(row(report, 'DEMO-1.1').violation).toBeNull();
    expect(report.violations.find((v) => v.id === 'DEMO-1.2')).toMatchObject({ rule: 'TEST-3.2' });
  });

  it('TEST-3.2: a test of any kind counts, a Behaviour test or a describe title', () => {
    const report = run({ units: [...baseUnits, unit(['DEMO-1.2', 'works']), unit('OTHER-1.1: also')], e2e: behaviour('DEMO-1.3: holds', 'DEMO-1.2: end to end') });
    expect(row(report, 'DEMO-1.2').violation).toBeNull();
    expect(row(report, 'DEMO-1.2').tests).toHaveLength(2);
  });

  it('TEST-3.2: an id later in a title is only a mention and doesn\'t count', () => {
    const report = run({ units: [...baseUnits, unit('keeps the list (DEMO-1.2)')] });
    expect(row(report, 'DEMO-1.2').violation).toBe('no test');
    expect(row(report, 'DEMO-1.2').mentions).toHaveLength(1);
  });

  it('TEST-3.3: fails when a ticked (e2e) criterion has no Behaviour test, even with a unit test', () => {
    const report = run();
    expect(row(report, 'DEMO-1.3').violation).toBeNull();
    expect(row(report, 'DEMO-1.4').violation).toBe('no Behaviour test');
    expect(report.violations.find((v) => v.id === 'DEMO-1.4')).toMatchObject({ rule: 'TEST-3.3' });
  });

  it('TEST-3.3: fails a ticked (e2e) criterion when there is no Playwright config', () => {
    const report = run({ e2e: null });
    expect(row(report, 'DEMO-1.3').violation).toBe('no Behaviour test');
  });

  it('TEST-3.4: fails when a test names an id that no spec has', () => {
    const report = run({ units: [...baseUnits, unit('DEMO-7.1: gone')], e2e: behaviour('DEMO-1.3: holds', 'OTHER-4.4: never was') });
    const unknown = report.violations.filter((v) => v.rule === 'TEST-3.4');
    expect(unknown.map((v) => v.id).sort()).toEqual(['DEMO-7.1', 'OTHER-4.4']);
    expect(unknown[0].message).toMatch(/no spec has/);
  });

  it('TEST-3.4: fails when a test names a struck-through criterion or requirement', () => {
    const report = run({ units: [...baseUnits, unit('DEMO-1.9: dropped'), unit(['DEMO-3', 'still here'])] });
    const struck = report.violations.filter((v) => v.rule === 'TEST-3.4');
    expect(struck.map((v) => v.id).sort()).toEqual(['DEMO-1.9', 'DEMO-3']);
    expect(struck[0].message).toMatch(/struck through/);
  });

  it('TEST-3.4: only codes from the features table are ids; requirement ids are valid in describe titles', () => {
    const report = run({ units: [...baseUnits, unit(['UTF-8', 'decodes']), unit('NOPE-1.1: not a code'), unit(['DEMO-2', 'DEMO-2.1: inside a requirement'])] });
    expect(report.violations.filter((v) => v.rule === 'TEST-3.4')).toEqual([]);
    expect(row(report, 'DEMO-2.1').tests).toHaveLength(2);
  });

  it('TEST-3.5: a tested (manual) criterion and an open criterion with tests are listed as information', () => {
    const report = run();
    expect(row(report, 'DEMO-1.5').info).toBe('manual, tested anyway');
    expect(row(report, 'DEMO-1.6').info).toBe('open, already tested');
    expect(report.info.map((i) => i.id)).toEqual(['DEMO-1.5', 'DEMO-1.6']);
    expect(failing(report)).not.toContain('DEMO-1.5');
    expect(failing(report)).not.toContain('DEMO-1.6');
  });

  it('TEST-3.5: an open (test) or (e2e) criterion without tests is fine and not listed', () => {
    const report = run();
    for (const id of ['DEMO-1.7', 'DEMO-1.8']) expect(row(report, id)).toMatchObject({ violation: null, info: null });
    expect(failing(report)).toEqual(['DEMO-1.2', 'DEMO-1.4', 'OTHER-1.1']);
  });

  it('TEST-3.6: prints each criterion per feature with tag, tick and tests, then the violations; exits 1', () => {
    const out = [];
    const code = main([], { root, listings: { vitest: () => baseUnits }, out: (s) => out.push(s) });
    expect(code).toBe(1);
    const text = out.join('\n');
    expect(text).toMatch(/^DEMO {2}Demo \(In Progress\)$/m);
    expect(text).toMatch(/^ {2}✓ DEMO-1\.1 \(test\) +ticked +demo\.test\.ts ×1$/m);
    expect(text).toMatch(/^ {2}✗ DEMO-1\.2 \(test\) +ticked +no test$/m);
    expect(text).toMatch(/^ {2}· DEMO-1\.7 \(test\) +open +no tests$/m);
    expect(text).toMatch(/^ {2}✓ DEMO-1\.5 \(manual\) +ticked +demo\.test\.ts ×1 \(info: manual, tested anyway\)$/m);
    expect(text).toMatch(/^OTHER {2}Other \(Ready\)$/m);
    expect(text).toMatch(/Info: No Playwright config, so no Behaviour tests were read\./);
    expect(text.indexOf('Violations:')).toBeGreaterThan(text.indexOf('OTHER-1.1'));
    expect(text).toMatch(/4 violations\. See docs\/features\/behaviour-tests\/SPEC\.md \(TEST-3\)\.$/);
  });

  it('TEST-3.6: --feature narrows the output and the exit code to one feature', () => {
    const out = [];
    const units = [...baseUnits, unit('DEMO-1.2: now tested')];
    const code = main(['--feature', 'DEMO'], { root, listings: { vitest: () => units, playwright: () => behaviour('DEMO-1.3: holds', 'DEMO-1.4: holds') }, out: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(out.join('\n')).not.toMatch(/OTHER/);
    expect(out.join('\n')).toMatch(/No violations\.$/);
  });

  it('TEST-3.6: --json prints the report machine-readable', () => {
    const out = [];
    const code = main(['--json', '--feature', 'OTHER'], { root, listings: { vitest: () => baseUnits }, out: (s) => out.push(s) });
    expect(code).toBe(1);
    const report = JSON.parse(out.join(''));
    expect(report.ok).toBe(false);
    expect(report.features.map((f) => f.code)).toEqual(['OTHER']);
    expect(report.violations).toEqual([expect.objectContaining({ id: 'OTHER-1.1', rule: 'TEST-3.2' })]);
  });

  it('TEST-3.6: an unknown --feature or a failing listing exits 1 with the reason', () => {
    const err = [];
    expect(main(['--feature', 'NOPE'], { root, listings: { vitest: () => [] }, out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(main([], { root, listings: { vitest: () => { throw new Error('`vitest list --json` failed'); } }, out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err.join('\n')).toMatch(/no feature NOPE[\s\S]*vitest list --json` failed/);
  });
});
