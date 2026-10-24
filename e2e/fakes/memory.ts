import { MB } from '../../shared/memory.ts';
import { PS_ARGS, SYSCTL_ARGS } from '../../server/memory.ts';
import type { MemoryDecl } from '../world/builder.ts';
import type { Outcome, Refusal } from './control.ts';

/** The real server and sampler pids keep ownership real; RSS and CPU are declared, never sampled. */
export function memoryAnswer(command: 'ps' | 'sysctl', argv: string[], decl: MemoryDecl, serverPid: number, samplerPid: number): Outcome | Refusal {
  const expected = command === 'ps' ? PS_ARGS : SYSCTL_ARGS;
  if (JSON.stringify(argv) !== JSON.stringify(expected)) return { refused: 'only the memory sampler argv is declared' };
  if (command === 'sysctl') {
    if (decl.sysctlFailure) return { code: 1, stderr: 'sysctl: refused\n' };
    return { code: 0, stdout: `${decl.ramBytes}\n${{ normal: 1, warn: 2, critical: 4 }[decl.pressure]}\n` };
  }
  if (decl.psFailure === 'timeout') return { hang: true };
  if (decl.psFailure === 'refused') return { code: 1, stderr: 'ps: refused\n' };
  const rows = [
    { pid: serverPid, ppid: 1, bytes: 64 * MB, cpuPct: 0, name: 'node' },
    { pid: samplerPid, ppid: serverPid, bytes: MB, cpuPct: 0, name: 'node' },
    ...decl.processes.map((p) => ({ ...p, ppid: p.ppid === 'lookout' ? serverPid : p.ppid })),
  ];
  return { code: 0, stdout: rows.map((p) => `${p.pid} ${p.ppid} ${Math.round(p.bytes / 1024)} ${p.cpuPct} ${p.name}`).join('\n') + '\n' };
}
