import { DEVCTL_ARGS, LISTEN_ARGS, PS_PORTS_ARGS, cwdArgs } from '../../server/ports.ts';
import type { PortsDecl } from '../world/builder.ts';
import type { Outcome, Refusal } from './control.ts';

const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * PORTS: the answers to Lookout's four Local server reads, as lsof, ps and tb-devctl print them. The
 * World's Lookout server is `'lookout'`; nothing is read from the runner's machine.
 */
export function portsAnswer(command: 'lsof' | 'ps' | 'tb-devctl', argv: string[], decl: PortsDecl, serverPid: number): Outcome | Refusal {
  const pid = (p: number | 'lookout') => (p === 'lookout' ? serverPid : p);
  const failed = (read: keyof NonNullable<PortsDecl['fail']>, refusal: string): Outcome | null =>
    decl.fail?.[read] === 'timeout' ? { hang: true } : decl.fail?.[read] === 'refused' ? { code: 2, stderr: `${refusal}\n` } : null;
  if (command === 'tb-devctl') {
    if (!same(argv, DEVCTL_ARGS)) return { refused: 'only `tb-devctl ps --json` is declared' };
    return failed('devctl', 'tb-devctl: refused') ?? { code: 0, stdout: `${JSON.stringify(decl.devctl, null, 2)}\n` };
  }
  if (command === 'ps') {
    if (!same(argv, PS_PORTS_ARGS)) return { refused: 'only the Local server read\'s ps argv is declared' };
    const rows = [{ pid: serverPid, ppid: 1, pgid: serverPid, etime: '10:00' }, ...decl.processes.map((p) => ({ ...p, ppid: pid(p.ppid), pgid: p.pgid ?? p.pid }))];
    return failed('ps', 'ps: refused') ?? { code: 0, stdout: rows.map((r) => `${r.pid} ${r.ppid} ${r.pgid} ${r.etime}`).join('\n') + '\n' };
  }
  if (same(argv, LISTEN_ARGS)) {
    const fail = failed('listen', 'lsof: refused');
    if (fail) return fail;
    // lsof exits 1, saying nothing, when nothing listens.
    if (!decl.listeners.length) return { code: 1 };
    const lines = decl.listeners.flatMap((l, i) => [`p${pid(l.pid)}`, `R${pid(l.ppid)}`, `c${l.command}`, ...l.addresses.flatMap((a, j) => [`f${10 + i + j}`, `n${a}`])]);
    return { code: 0, stdout: `${lines.join('\n')}\n` };
  }
  const asked = argv.at(-1)?.split(',') ?? [];
  if (same(argv, cwdArgs(asked.map(Number)))) {
    const fail = failed('cwds', 'lsof: refused');
    if (fail) return fail;
    const known = asked.filter((p) => decl.cwds[p] ?? (Number(p) === serverPid ? decl.cwds.lookout : undefined));
    const lines = known.flatMap((p) => [`p${p}`, 'fcwd', `n${decl.cwds[p] ?? decl.cwds.lookout}`]);
    // As lsof does, a pid it can't report fails the run, with the others still printed.
    return { code: known.length === asked.length ? 0 : 1, stdout: lines.length ? `${lines.join('\n')}\n` : '' };
  }
  return { refused: 'only the Local server reads\' lsof argvs are declared' };
}
