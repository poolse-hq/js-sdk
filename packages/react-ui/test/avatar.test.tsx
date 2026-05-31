import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../src/Avatar.js';

describe('<Avatar>', () => {
  it('renders initials from a multi-word name', () => {
    const { container } = render(<Avatar name="Jane Doe" />);
    expect(container.textContent).toBe('JD');
  });

  it('renders single initial for one-word name', () => {
    const { container } = render(<Avatar name="alice" />);
    expect(container.textContent).toBe('A');
  });

  it('renders ? when name is missing', () => {
    const { container } = render(<Avatar />);
    expect(container.textContent).toBe('?');
  });

  it('renders an <img> when src is provided', () => {
    const { container } = render(<Avatar src="https://x.test/a.png" name="Jane" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x.test/a.png');
    // Initials should be absent when an image is rendered.
    expect(container.textContent).toBe('');
  });

  it('renders presence dot when online=true', () => {
    const { container } = render(<Avatar name="x" online />);
    expect(container.querySelector('.poolse-avatar__presence')).not.toBeNull();
  });

  it('applies size modifier classes', () => {
    const { container: sm } = render(<Avatar name="x" size="sm" />);
    expect(sm.querySelector('.poolse-avatar--sm')).not.toBeNull();
    const { container: lg } = render(<Avatar name="x" size="lg" />);
    expect(lg.querySelector('.poolse-avatar--lg')).not.toBeNull();
  });
});
