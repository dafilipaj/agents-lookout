import type { PortsDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { portsAnswer } from './ports.ts';

await serveCall<PortsDecl>('lsof', (argv, answer) => portsAnswer('lsof', argv, answer, process.ppid));
