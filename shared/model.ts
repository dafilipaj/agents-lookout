/** Model ids as Fleet takes them (`spawn --model`, `model`): letters, digits and `._[]/:-`, at most 100. */
export const MODEL_ID = /^[A-Za-z0-9._[\]/:-]{0,100}$/;

/** A model id without what VIEW-6.1 ignores: case, a trailing `[1m]`, then a trailing date (`-20251001`). */
function core(id: string): string {
  return id.toLowerCase().replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');
}

/** VIEW-6.1: whether two model ids name the same model, a `[1m]` or a date suffix aside. */
export function sameModel(a: string, b: string): boolean {
  return core(a) === core(b);
}

/** VIEW-7: an Effort level as Fleet's `effort` takes it: lowercase letters, at most 16. */
export const EFFORT_LEVEL = /^[a-z]{1,16}$/;

/** The levels' order, lowest first, as Fleet puts them (Codex's own order); others go last. */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/**
 * VIEW-7.1: the Effort levels Fleet lists for a model, matched by VIEW-6.1's rule (its listed
 * entries, never the "Default" one); for a model it doesn't list (or none known), every level it
 * lists for the Harness, lowest first.
 */
export function effortLevels(models: readonly { id: string; efforts: readonly string[] }[], model: string | null): string[] {
  const own = model === null ? undefined : models.find((m) => m.id !== '' && sameModel(m.id, model));
  if (own) return [...own.efforts];
  const all = [...new Set(models.flatMap((m) => m.efforts))];
  const rank = (level: string) => {
    const i = EFFORT_ORDER.indexOf(level);
    return i === -1 ? EFFORT_ORDER.length : i;
  };
  return all.sort((a, b) => rank(a) - rank(b));
}
