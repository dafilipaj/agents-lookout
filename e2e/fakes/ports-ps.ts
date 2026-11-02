import type { PortsDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { portsAnswer } from './ports.ts';

await serveCall<PortsDecl>('ps', (argv, answer) => portsAnswer('ps', argv, answer, process.ppid));
