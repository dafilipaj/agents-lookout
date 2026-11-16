import { describe, expect, it } from 'vitest';
import { IDLE_OFF_MS, atWorkCount, isAtWork, offAtFor, parseAwakeRequest } from './awake.ts';

describe('AWAKE-2 shared rules', () => {
  it('AWAKE-2.1: At work is Busy, or a Subagent or background shell command still running; Needs you, Idle and Done alone are not', () => {
    const idle = { status: 'idle' as const, subagents: null, backgroundShell: false };
    expect(isAtWork({ ...idle, status: 'busy' })).toBe(true);
    expect(isAtWork({ ...idle, subagents: { running: 2, finished: 1 } })).toBe(true);
    expect(isAtWork({ ...idle, status: 'needs-you', backgroundShell: true })).toBe(true);
    expect(isAtWork({ ...idle, status: 'needs-you' })).toBe(false);
    expect(isAtWork({ ...idle, subagents: { running: 0, finished: 3 } })).toBe(false);
    expect(isAtWork({ ...idle, status: 'unknown' })).toBe(false);
    expect(atWorkCount([idle, { ...idle, status: 'busy' }, { ...idle, backgroundShell: true }])).toBe(2);
  });

  it('AWAKE-2.2: off 5 minutes after the later of turning on and the last Session At work; never while off or At work', () => {
    expect(offAtFor('awake', 0, 1000, null)).toBe(1000 + IDLE_OFF_MS);
    expect(offAtFor('lid', 0, 1000, 9000)).toBe(9000 + IDLE_OFF_MS);
    expect(offAtFor('awake', 0, 9000, 1000)).toBe(9000 + IDLE_OFF_MS);
    expect(offAtFor('awake', 1, 1000, null)).toBeNull();
    expect(offAtFor('off', 0, 1000, null)).toBeNull();
    expect(IDLE_OFF_MS).toBe(5 * 60_000);
  });

  it('AWAKE-1.1: a request is a mode of three and an optional replace', () => {
    expect(parseAwakeRequest({ mode: 'lid', replace: true })).toEqual({ mode: 'lid', replace: true });
    expect(parseAwakeRequest({ mode: 'off' })).toEqual({ mode: 'off', replace: false });
    expect(parseAwakeRequest({ mode: 'sleep' })).toBeNull();
    expect(parseAwakeRequest({ mode: 'awake', replace: 'yes' })).toBeNull();
    expect(parseAwakeRequest(null)).toBeNull();
  });
});
