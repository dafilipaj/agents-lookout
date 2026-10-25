import type { MemoryDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { memoryAnswer } from './memory.ts';

await serveCall<MemoryDecl>('ps', (argv, answer) => memoryAnswer('ps', argv, answer, process.ppid, process.pid));
