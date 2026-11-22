import { describe, expect, it, vi } from 'vitest';
import { guardRejections, rejectionLine } from './crash-guard.ts';

describe('the crash guard (Plan item 61)', () => {
  it('names an unhandled rejection and where it was thrown, never its message', () => {
    const line = rejectionLine(Object.assign(new Error('fleet send abc "my secret prompt" failed'), { code: 'ENOENT' }));
    expect(line).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z unhandled rejection: Error \(ENOENT\)\n\s+at /);
    expect(line).not.toContain('secret');
    expect(rejectionLine(new TypeError('x'))).toContain('unhandled rejection: TypeError');
    expect(rejectionLine('a string with a token')).toMatch(/unhandled rejection: string$/);
  });

  it('a rejection nobody handles is logged and the process goes on; disposing it stops that', () => {
    const write = vi.fn();
    const dispose = guardRejections(write);
    process.emit('unhandledRejection', new RangeError('gone'), Promise.resolve());
    expect(write).toHaveBeenCalledWith(expect.stringContaining('unhandled rejection: RangeError'));
    dispose();
    expect(process.listeners('unhandledRejection')).not.toContain(write);
  });
});
