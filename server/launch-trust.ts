import type { LaunchTrust } from '../shared/types.ts';

export const TRUST_ID = /^t1\.[0-9a-f]{8}$/;
export const TRUST_UNCERTAIN = "It may have been answered, but Lookout can't tell.";
const DETAILS = new Set(['no_prompt', 'shell', 'different_prompt', 'touched', 'not_alone', 'clipped', 'layout_unsupported']);
const KINDS = new Set(['usage', 'target_not_found', 'target_invalid', 'target_changed', 'host_unsupported', 'busy', 'human_attached', 'prompt_not_on_screen', 'prompt_incomplete', 'prompt_changed', 'outcome_uncertain', 'backend_failed', 'io']);

export function object(text: string | undefined): Record<string, unknown> | null {
  try { const v: unknown = JSON.parse(text ?? ''); return record(v); } catch { return null; }
}
function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
/** Log codes are allow-listed; even a syntactically plausible unknown code may contain screen text. */
export function trustCode(v: unknown, type: 'kind' | 'detail'): string {
  return v == null ? 'none' : typeof v === 'string' && (type === 'kind' ? KINDS : DETAILS).has(v) ? v : 'other';
}

export function trustMessage(kind: unknown, detail: unknown, pane?: unknown): string {
  if (kind === 'busy') return 'An answer to this prompt is being typed right now.';
  if ((typeof kind === 'string' && ['target_not_found', 'target_changed', 'target_invalid', 'host_unsupported'].includes(kind)) || detail === 'no_prompt' || detail === 'shell') return 'The prompt is gone, so nothing was typed.';
  switch (detail) {
    case 'different_prompt': return 'The prompt changed before Lookout answered, so nothing was typed.';
    case 'touched': return "Its answer was changed in a terminal, so Lookout won't answer it.";
    case 'not_alone': return "Something else shows in the terminal with this prompt, so Lookout won't answer it.";
    case 'clipped': {
      const p = record(pane);
      const valid = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 100_000;
      const size = p && valid(p.cols) && valid(p.rows) ? ` (${p.cols}×${p.rows})` : '';
      return `This prompt doesn't fit in the terminal${size}, so Lookout can't read it whole.`;
    }
    case 'layout_unsupported': return "Lookout can't read this version of Claude Code's prompt.";
    default: return "Lookout can't answer this prompt safely, so nothing was typed.";
  }
}

/** null: no Trust prompt; undefined: unusable read, retain the last reliable screen. */
export function parseTrustRead(res: Record<string, unknown> | null): LaunchTrust | null | undefined {
  if (res?.ok !== true || typeof res.answerable !== 'boolean') return undefined;
  if (res.detail !== null && typeof res.detail !== 'string') return undefined;
  if (res.prompt === null && (res.detail === 'no_prompt' || res.detail === 'shell')) return null;
  const p = record(res.prompt);
  if (p?.kind !== 'trust' || p.harness !== 'claude') return undefined;
  const detail = res.detail === null ? null : trustCode(res.detail, 'detail');
  if (p.incomplete === true && p.id === null && p.lines === null && !res.answerable) {
    return { id: null, lines: null, answerable: false, detail, answering: null, message: trustMessage(null, detail, res.pane) };
  }
  if (typeof p.id !== 'string' || !TRUST_ID.test(p.id) || !Array.isArray(p.lines) || p.lines.length > 60 || !p.lines.every((l) => typeof l === 'string' && l.length <= 2000)) return undefined;
  // Fleet already removed terminal framing. Remove controls without redacting the words being judged.
  const lines = p.lines.map((l: string) => l.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')); // eslint-disable-line no-control-regex
  const answerable = res.answerable && detail === null && p.untouched === true;
  return { id: p.id, lines, answerable, detail, answering: null, message: answerable ? null : trustMessage(null, detail, res.pane) };
}
