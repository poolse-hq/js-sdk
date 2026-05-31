import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PoolseLogo } from '../src/PoolseLogo.js';

describe('<PoolseLogo>', () => {
  it('defaults to lockup variant with poolse aria-label', () => {
    const { container } = render(<PoolseLogo />);
    const svg = container.querySelector('svg.poolse-logo')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 454 100');
    expect(svg.getAttribute('aria-label')).toBe('poolse');
  });

  it('mark variant renders only the chip with a 1:1 viewBox', () => {
    const { container } = render(<PoolseLogo variant="mark" />);
    const svg = container.querySelector('svg.poolse-logo')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    // Mark has the tile, pulse and pulse-dot but no wordmark.
    expect(svg.querySelector('.mk-tile')).not.toBeNull();
    expect(svg.querySelector('.wm-ink')).toBeNull();
  });

  it('mono variant adds the mono class for currentColor styling', () => {
    const { container } = render(<PoolseLogo variant="mono" />);
    expect(container.querySelector('svg.poolse-logo--mono')).not.toBeNull();
  });

  it('size controls the rendered height', () => {
    const { container } = render(<PoolseLogo variant="mark" size={48} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('height')).toBe('48');
    expect(svg.getAttribute('width')).toBe('48'); // 1:1 aspect
  });
});
