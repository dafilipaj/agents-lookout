import type { DockUsageDecl } from '../world/builder.ts';
import type { Outcome, Refusal } from './control.ts';

export function fleetUsageAnswer(argv: string[], decl: DockUsageDecl, now: Date): Outcome | Refusal {
  if (JSON.stringify(argv) !== JSON.stringify(['--local', 'usage', '--json'])) return { refused: 'only `fleet --local usage --json` is declared' };
  const providers = (['claude', 'codex'] as const).map((id) => ({
    id, status: 'ok', plan: null, error: null, fetched_at: now.toISOString(), observed_at: now.toISOString(), credits: null,
    limits: [
      { kind: 'session', label: '5-hour', percent: decl[id].session, resets_at: new Date(now.getTime() + 5 * 3_600_000).toISOString() },
      { kind: 'weekly_all', label: 'Weekly', percent: decl[id].weekly_all, resets_at: new Date(now.getTime() + 7 * 24 * 3_600_000).toISOString() },
    ],
  }));
  return { code: 0, stdout: JSON.stringify({ providers }) };
}

export function jevAnswer(argv: string[], decl: DockUsageDecl): Outcome | Refusal {
  if (JSON.stringify(argv) !== JSON.stringify(['status', '--json'])) return { refused: 'only `tb-jev status --json` is declared' };
  const ready = decl.jev === 'ready';
  return { code: ready ? 0 : 4, stdout: JSON.stringify({ version: '0.2.0', ready, key_present: ready, key_source: ready ? 'config' : 'none', base_url: null, config_used: false }) };
}
