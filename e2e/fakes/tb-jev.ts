import type { DockUsageDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { jevAnswer } from './usage.ts';

await serveCall<DockUsageDecl>('tb-jev', jevAnswer);
