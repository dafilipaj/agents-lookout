import type { DockUsageDecl } from '../world/builder.ts';
import { serveCall } from './control.ts';
import { fleetUsageAnswer } from './usage.ts';

await serveCall<DockUsageDecl>('fleet-usage', fleetUsageAnswer);
