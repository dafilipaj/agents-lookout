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
