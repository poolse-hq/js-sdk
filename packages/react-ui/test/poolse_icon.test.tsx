import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PoolseIcon } from '../src/PoolseIcon.js';

describe('<PoolseIcon>', () => {
  it('renders an svg with the known icon class', () => {
    const { container } = render(<PoolseIcon name="send" />);
    const svg = container.querySelector('svg.poolse-icon');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('uses the icon name as default aria-label', () => {
    const { container } = render(<PoolseIcon name="send" />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('send');
  });

  it('respects label override', () => {
    const { container } = render(<PoolseIcon name="send" label="Submit" />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Submit');
  });

  it('hides from AT when label is null', () => {
    const { container } = render(<PoolseIcon name="send" label={null} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('aria-label')).toBeNull();
  });

  it('renders an empty svg + warns for an unknown name', () => {
    const orig = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      // @ts-expect-error — intentional bad name
      const { container } = render(<PoolseIcon name="not-real" />);
      expect(container.querySelector('svg')).not.toBeNull();
      expect(warned).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it('size prop sets width/height', () => {
    const { container } = render(<PoolseIcon name="send" size={32} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });
});
