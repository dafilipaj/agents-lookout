import { render, screen } from '@testing-library/react';
import { siClaude } from 'simple-icons';
import { describe, expect, it } from 'vitest';
import { HarnessIcon } from './HarnessIcon';

describe('HarnessIcon', () => {
  it('DS-3.1: a Harness logo is monochrome by default, in the text colour around it; brand gives Claude its colour', () => {
    render(
      <>
        <HarnessIcon harness="claude" />
        <HarnessIcon harness="codex" />
        <HarnessIcon harness="claude" tone="brand" className="size-4" />
        <HarnessIcon harness="codex" tone="brand" />
      </>,
    );
    const [claude, codex, claudeBrand, codexBrand] = [...document.querySelectorAll('svg[data-harness]')];
    expect(claude).toHaveAttribute('data-tone', 'mono');
    expect(claude).toHaveAttribute('fill', 'currentColor');
    expect(codex).toHaveAttribute('fill', 'currentColor');
    expect(claudeBrand).toHaveAttribute('data-tone', 'brand');
    expect(claudeBrand).toHaveAttribute('fill', `#${siClaude.hex}`);
    // OpenAI draws its mark in the text colour, so Codex's brand is the text colour too.
    expect(codexBrand).toHaveAttribute('fill', 'currentColor');
    // The tone changes only the colour: the name stays.
    expect(screen.getAllByRole('img', { name: 'Claude Code' })).toHaveLength(2);
  });
});
