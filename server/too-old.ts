/**
 * TOOLS-2.5: a Tool that answers as one too old for what it was asked: clap's usage error for a
 * subcommand or flag it doesn't have, exit 2 (`error: unrecognized subcommand 'events'`,
 * `error: unexpected argument '--harness' found`). Its section says the Tool is too old, never that
 * it isn't installed.
 */
// eslint-disable-next-line no-control-regex -- ANSI colour codes are what's being stripped
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
/** Long flags only: Lookout passes no short ones, so `unexpected argument '-l'` is a value clap read as a flag, not a missing flag. */
const REFUSAL = /\berror: (?:unrecognized subcommand '[^'\n]+'|unexpected argument '--[^'\n]+')/;

export function refusedAsTooOld(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; stderr?: unknown };
  return e.code === 2 && typeof e.stderr === 'string' && REFUSAL.test(e.stderr.replace(ANSI, ''));
}
