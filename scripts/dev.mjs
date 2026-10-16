// `pnpm dev`: the Lookout server (restarts on change) plus Vite (hot reload), which proxies /api.
import { spawn } from 'node:child_process';

const port = process.env.LOOKOUT_PORT ?? '4747';
const devPort = process.env.LOOKOUT_DEV_PORT ?? '4748';
const env = {
  ...process.env,
  LOOKOUT_PORT: port,
  LOOKOUT_DEV_PORT: devPort,
  LOOKOUT_DEV_ORIGINS: `http://127.0.0.1:${devPort},http://localhost:${devPort}`,
};

const children = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=shared', 'server/main.ts'], { stdio: 'inherit', env }),
  spawn('pnpm', ['exec', 'vite'], { stdio: 'inherit', env }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
};
for (const c of children) c.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
