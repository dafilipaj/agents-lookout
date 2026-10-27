import { describe, expect, it } from 'vitest';
import { safeName } from './attachments.ts';

describe('attachment names', () => {
  it('VIEW-9.11: keeps a safe basename, Unicode letters and digits, replaces runs and never starts hidden', () => {
    expect(safeName('C:\\Desktop\\Screenshot 2026-10-27 at 10.12.03.png')).toBe('Screenshot-2026-10-27-at-10.12.03.png');
    expect(safeName('/../../.---Résumé 日本語_１２.txt')).toBe('Résumé-日本語_１２.txt');
    for (const name of ['', '.', '..', '---', '$ &']) expect(safeName(name)).toBe('attachment');
    expect(safeName('a_+@,:=~b.tar.gz')).toBe('a_-b.tar.gz');
    const long = safeName(`${'日'.repeat(100)}.png`);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.png')).toBe(true);
    expect(long).not.toContain('�');
    expect(new TextEncoder().encode(safeName(`a.${'日'.repeat(100)}`)).length).toBeLessThanOrEqual(120);
    const collision = safeName(`${'日'.repeat(100)}.png`, 2);
    expect(collision.endsWith('-2.png')).toBe(true);
    expect(new TextEncoder().encode(collision).length).toBeLessThanOrEqual(120);
  });
});
