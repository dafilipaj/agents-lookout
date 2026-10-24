import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { memoryAnswer } from '../e2e/fakes/memory.ts';
import { DEFAULT_MEMORY, checkMemory, world } from '../e2e/world/builder.ts';
import { MB, buildOwners, parseProcesses } from '../shared/memory.ts';
import { PS_ARGS, SYSCTL_ARGS } from './memory.ts';

it('MEM-2.1: World sampling uses exact-argv fakes and declared rows plus actual server and sampler pids', () => {
  const decl = { ...DEFAULT_MEMORY, processes: [{ pid: 500, ppid: 'lookout' as const, bytes: 100 * MB, cpuPct: 140, name: 'node' }] };
  const base = world();
  const configured = base.memory(decl);
  expect(base.spec.memory.processes).toEqual([]);
  expect(configured.spec.memory).toEqual(decl);
  const ps = memoryAnswer('ps', [...PS_ARGS], decl, 100, 101);
  expect(ps).toHaveProperty('code', 0);
  if (!('stdout' in ps)) throw new Error('ps must print its declared answer');
  const owners = buildOwners(parseProcesses(ps.stdout!), 100, []);
  expect(owners.lookout.bytes).toBe(165 * MB);
  expect(owners.lookout.cpuPct).toBe(140);
  expect(owners.otherBytes).toBe(0);
  expect(memoryAnswer('sysctl', [...SYSCTL_ARGS], { ...decl, pressure: 'warn' }, 100, 101)).toEqual({ code: 0, stdout: `${decl.ramBytes}\n2\n` });
  expect(memoryAnswer('sysctl', ['-n', 'hw.memsize'], decl, 100, 101)).toHaveProperty('refused');
  expect(memoryAnswer('ps', ['-axo', 'command='], decl, 100, 101)).toHaveProperty('refused');
  expect(memoryAnswer('ps', [...PS_ARGS], { ...decl, psFailure: 'timeout' }, 100, 101)).toEqual({ hang: true });
  expect(memoryAnswer('ps', [...PS_ARGS], { ...decl, psFailure: 'refused' }, 100, 101)).toHaveProperty('code', 1);
  expect(memoryAnswer('sysctl', [...SYSCTL_ARGS], { ...decl, sysctlFailure: true }, 100, 101)).toHaveProperty('code', 1);
  for (const bad of [{ ramBytes: 0 }, { pressure: 'unknown' }, { processes: [{ ...decl.processes[0]!, name: '/home/private/node' }] }]) {
    expect(() => checkMemory({ ...decl, ...bad } as typeof decl)).toThrow();
  }
});

it('TEST-1.2 / MEM-2.1: the World sysctl wrapper passes unrelated callers through while memory reads always stay faked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookout-sysctl-'));
  const wrapper = join(dir, 'sysctl');
  const fallback = join(dir, 'system-sysctl');
  const calls = join(dir, 'fallback-calls');
  const violations = join(dir, 'violations.jsonl');
  try {
    writeFileSync(join(dir, 'answer.json'), JSON.stringify(DEFAULT_MEMORY));
    writeFileSync(fallback, `#!/bin/sh
printf '%s\\n' "$@" >> '${calls}'
printf 'system boot time\\n'
printf 'system diagnostic\\n' >&2
exit 7
`, { mode: 0o755 });
    let template = readFileSync(new URL('../e2e/shims/sysctl', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries({ NAME: 'sysctl', LOG: join(dir, 'calls.log'), NODE: process.execPath, SCRIPT: fileURLToPath(new URL('../e2e/fakes/sysctl.ts', import.meta.url)), STATE: dir, VIOLATIONS: violations, REAL_SYSCTL: fallback })) {
      template = template.replaceAll(`@${name}@`, value);
    }
    writeFileSync(wrapper, template, { mode: 0o755 });
    const invoke = (argv: readonly string[]) => spawnSync(wrapper, [...argv], { encoding: 'utf8' });

    // Login-shell startup must get the system command's stdout, stderr and exit status.
    const boot = invoke(['-n', 'kern.boottime']);
    expect(boot.status).toBe(7);
    expect(boot.stdout).toBe('system boot time\n');
    expect(boot.stderr).toBe('system diagnostic\n');
    expect(readFileSync(calls, 'utf8')).toBe('-n\nkern.boottime\n');
    expect(existsSync(violations)).toBe(false);

    const sample = invoke(SYSCTL_ARGS);
    expect(sample.status).toBe(0);
    expect(sample.stdout).toBe(`${DEFAULT_MEMORY.ramBytes}\n1\n`);
    for (const argv of [['-n', 'hw.memsize'], ['-n', 'kern.memorystatus_vm_pressure_level'], ['-n', 'kern.boottime', 'hw.memsize']]) {
      const malformed = invoke(argv);
      expect(malformed.status).toBe(2);
      expect(malformed.stderr).toContain('only the memory sampler argv is declared');
    }
    expect(readFileSync(calls, 'utf8')).toBe('-n\nkern.boottime\n');
    expect(readFileSync(violations, 'utf8').trim().split('\n')).toHaveLength(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
