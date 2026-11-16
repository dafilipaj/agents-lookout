import { serveCall } from './control.ts';

/**
 * The World's `caffeinate` (AWAKE-1.2): it takes only `-i -w <pid>`, holds nothing, and stays until
 * it's ended or the process it waits on is gone, as the real one does.
 */
let waitOn: number | null = null;
await serveCall<Record<string, never>>('caffeinate', (argv) => {
  const m = argv.length === 3 && argv[0] === '-i' && argv[1] === '-w' && /^\d+$/.test(argv[2]!) ? Number(argv[2]) : null;
  if (m === null) return { refused: 'only `caffeinate -i -w <pid>` is answered' };
  waitOn = m;
  return { code: 0 };
});
if (waitOn !== null) {
  const pid = waitOn;
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      process.exit(0);
    }
  }, 500);
}
