// Types for plain-shots-render.mjs, which runs with the Checkout's Node as plain JavaScript.
export interface ShotInput {
  zip: string;
  callId: string;
  selector: string;
  absent?: boolean;
  viewport: { width: number; height: number };
  out: string;
}
export interface ShotAnswer {
  out: string;
  box: { x: number; y: number; w: number; h: number } | null;
  absent: boolean;
  error: string | null;
}
export function runnerCore(root: string): { dir: string; load: () => unknown };
export function containerOf(selector: string): string | null;
export function keepStyles(): void;
export function markedBox(): { x1: number; y1: number; x2: number; y2: number } | null;
export function answerOf(shots: readonly ShotInput[], done: Map<ShotInput, ShotAnswer>, missing: string): { results: ShotAnswer[] };
export function render(input: { root: string; deadline?: number; shots?: ShotInput[] }, done?: Map<ShotInput, ShotAnswer>): Promise<{ results: ShotAnswer[] }>;
