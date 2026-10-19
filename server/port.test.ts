import { describe, expect, it } from 'vitest';
import { parsePort } from './port.ts';

describe('LOOKOUT_PORT', () => {
  it('TEST-1.1: 0 lets the OS pick a port, a number is that port, unset is the default', () => {
    expect(parsePort('0', 4747)).toBe(0);
    expect(parsePort('5123', 4747)).toBe(5123);
    expect(parsePort('65535', 4747)).toBe(65535);
    expect(parsePort(undefined, 4747)).toBe(4747);
  });

  it('TEST-1.1: an empty or other value stops the server at startup', () => {
    for (const bad of ['', ' ', '80 ', ' 80', '-1', '+80', '1e3', '0x10', '80.0', '65536', 'abc']) {
      expect(() => parsePort(bad, 4747), JSON.stringify(bad)).toThrow(/^Invalid LOOKOUT_PORT/);
    }
  });
});
