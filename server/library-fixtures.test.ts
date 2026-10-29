import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { materializeOutputs } from '../e2e/fakes/outputs.ts';
import { respond } from '../e2e/fakes/tb-session.ts';
import { world } from '../e2e/world/builder.ts';

const execFileP = promisify(execFile);
it('LIB-2.6: World declarations write real parent, Subagent and fork tool Transcripts, source files, gone folders and git fixtures without grouping facts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-output-fixtures-'));
  try {
    const spec = world().outputs([
      { kind: 'file', path: 'output/report.md', events: 2 },
      { kind: 'file', path: 'output/map.html' },
      { kind: 'artifact', sourcePath: 'output/map.html', title: 'Map' },
      { kind: 'artifact', sourcePath: 'output/refused.html', refused: true },
      { kind: 'share', sourcePath: 'output/report.md', json: true },
      { kind: 'share', json: false },
      { kind: 'file', path: 'output/subagent.md', subagent: true },
      { kind: 'file', path: 'output/report.md', events: 2, forkOf: 'library-writer', sessionId: 'library-fork', sessionCreatedAt: '2026-10-24T10:00:00Z' },
      { kind: 'file', path: 'scratch/cleared/report.html', directoryGone: true },
      { kind: 'file', path: 'output/gone.pdf', exists: false },
      { kind: 'file', path: 'Projects/repo/report.md', git: 'tracked' },
      { kind: 'file', path: 'Projects/repo/ignored/report.md', git: 'ignored' },
      { kind: 'file', path: 'output/missing.html', sessionId: 'library-missing', transcriptMissing: true },
      { kind: 'file', path: 'output/pruned.html', sessionId: 'library-pruned', pruned: true },
    ]).declaration();
    const fixtures = await materializeOutputs(home, spec.outputs!.items);
    expect(fixtures.missingTranscripts).toHaveLength(1); expect(fixtures.prunedTranscripts).toHaveLength(1);
    expect((await stat(join(home, 'output/subagent.md'))).isFile()).toBe(true);
    expect((await stat(join(home, 'output'))).isDirectory()).toBe(true);
    await expect(stat(join(home, 'output/gone.pdf'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(home, 'scratch/cleared'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(home, 'Projects/repo/.gitignore'), 'utf8')).toContain('ignored/report.md');
    const roots = await readdir(join(home, '.claude/projects'));
    const parent = await readFile(join(home, '.claude/projects', roots[0]!, 'library-writer.jsonl'), 'utf8');
    expect(parent).toContain('"name":"Write"'); expect(parent).toContain('"name":"Edit"'); expect(parent).toContain('"name":"Artifact"'); expect(parent).toContain('"is_error":true'); expect(parent).toContain('tb-backyard share upload');
    expect(parent).toContain('Share created'); expect(parent).toContain('\\"files\\":[]');
    const subagent = await readFile(join(home, '.claude/projects', roots[0]!, 'library-writer/subagents/agent-world-6.jsonl'), 'utf8'); expect(subagent).toContain('"sessionId":"library-writer"');
    const fork = await readFile(join(home, '.claude/projects', roots[0]!, 'library-fork.jsonl'), 'utf8'); expect(fork).toContain('"id":"tool-world-0"'); expect(fork).toContain('"id":"tool-world-0-edit-1"');
    // Missing/pruned Transcripts still exist here: the World indexes before removing them.
    expect((await stat(fixtures.missingTranscripts[0]!)).isFile()).toBe(true);
    expect(respond(['events', '--json'], { results: [], sessions: [], unsupported: true })).toEqual({ code: 2, stderr: "error: unrecognized subcommand 'events'\n" });
    expect(respond(['events', '--json', '--mystery'], { results: [], sessions: [] })).toHaveProperty('refused');
    expect(() => world().outputs([{ kind: 'file', path: '../escape.html' }])).toThrow('relative to HOME');
    expect(world().declaration().outputs).toBeNull();
  } finally { await rm(home, { recursive: true, force: true }); }
});

it('LIB-2.1: the unit fake answers raw events and unlimited list paging; extension filtering keeps source-less Shares only on the separate kind call', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lookout-events-fake-'));
  try {
    const eventsFile = join(home, 'events.json');
    await writeFile(eventsFile, JSON.stringify([
      { id: 1, kind: 'write', key: '@root/report.MD', path: '@root/report.MD', timestamp: '2026-10-23T10:00:00Z', session_id: 'world-writer', harness: 'claude' },
      { id: 2, kind: 'artifact', key: 'https://claude.ai/public/artifacts/world', source_path: '@root/report.MD', timestamp: '2026-10-23T11:00:00Z', session_id: 'world-writer', harness: 'claude' },
      { id: 3, kind: 'share', key: 'world-share', url: 'https://backyard.productive.io/s/world-share', timestamp: '2026-10-23T12:00:00Z', session_id: 'world-writer', harness: 'claude' },
    ]));
    const call = async (args: string[]) => JSON.parse((await execFileP(process.execPath, ['server/fixtures/tb-session/fake-tb-session.mjs', ...args], { env: { FAKE_TB_SESSION_EVENTS_FILE: eventsFile, FAKE_TB_SESSION_ROOT: home } })).stdout);
    const files = await call(['events', '--all-projects', '--json', '--kind', 'write,edit', '--ext', 'md', '--limit', '100000']);
    expect(files).toMatchObject({ total_results: 1, results: [{ kind: 'write', path: join(home, 'report.MD') }] });
    const links = await call(['events', '--all-projects', '--json', '--kind', 'artifact,share', '--limit', '100000']);
    expect(links.total_results).toBe(2); expect(links.results[0].kind).toBe('share'); expect(links.results[1].kind).toBe('artifact');
    expect((await call(['events', '--all-projects', '--json', '--ext', 'md', '--limit', '100000'])).total_results).toBe(2);
    expect((await call(['list', '--all-projects', '--json', '--limit', '100000'])).results.length).toBeGreaterThan(0);
  } finally { await rm(home, { recursive: true, force: true }); }
});
