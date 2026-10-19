/**
 * `LOOKOUT_PORT`: digits only, 0–65535. 0 lets the OS pick a free port (a Behaviour test's World,
 * TEST-1.1); anything else that isn't a port, an empty value included, stops the server at startup.
 */
export function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid LOOKOUT_PORT: ${JSON.stringify(raw)}`);
  return port;
}
