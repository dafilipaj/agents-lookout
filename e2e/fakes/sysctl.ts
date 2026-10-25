import type { MemoryDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { memoryAnswer } from './memory.ts';

await serveCall<MemoryDecl>('sysctl', (argv, answer) => memoryAnswer('sysctl', argv, answer, process.ppid, process.pid));
