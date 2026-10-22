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
