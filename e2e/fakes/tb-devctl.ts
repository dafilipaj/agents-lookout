import type { PortsDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { portsAnswer } from './ports.ts';

await serveCall<PortsDecl>('tb-devctl', (argv, answer) => portsAnswer('tb-devctl', argv, answer, process.ppid));
