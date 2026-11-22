/**
 * Plan item 61: a promise nobody waited on that fails ends a Node process by default, and every view
 * with it. The server logs it instead and goes on. The line names the error and where it was thrown,
 * not its message, which can hold a command's arguments or a Session's words.
 */
export function rejectionLine(reason: unknown): string {
  const at = new Date().toISOString();
  if (!(reason instanceof Error)) return `${at} unhandled rejection: ${typeof reason}`;
  const code = (reason as { code?: unknown }).code;
  const frames = (reason.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l)).slice(0, 8);
  return [`${at} unhandled rejection: ${reason.name}${typeof code === 'string' || typeof code === 'number' ? ` (${code})` : ''}`, ...frames].join('\n');
}

/** Logs each unhandled rejection through `write`, so the process goes on. */
export function guardRejections(write: (line: string) => void): () => void {
  const onRejection = (reason: unknown) => write(rejectionLine(reason));
  process.on('unhandledRejection', onRejection);
  return () => void process.off('unhandledRejection', onRejection);
}
