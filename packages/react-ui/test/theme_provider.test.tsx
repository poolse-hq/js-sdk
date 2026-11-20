import { act, render } from '@testing-library/react';
import { BUILT_IN_THEMES, createTheme } from '@poolse/theme';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PoolseTheme, useTheme } from '../src/index.js';

function wrapper(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.poolse-theme');
  if (!(el instanceof HTMLElement)) throw new Error('no theme wrapper');
  return el;
}

// A child that counts its mounts and shows what useTheme() sees.
let mounts = 0;
function Probe() {
  const { theme, colorScheme } = useTheme();
  useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <span data-testid="probe">
      {theme?.id ?? 'none'}/{colorScheme}
    </span>
  );
}

// matchMedia stub whose "dark" answer can be flipped at runtime.
function stubSystemScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as unknown as MediaQueryList);
  return {
    set(next: boolean) {
      dark = next;
      for (const fn of listeners) fn();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  mounts = 0;
});

describe('<PoolseTheme>', () => {
  it('sets a built-in theme’s variables on its own wrapper, not on :root', () => {
    const { container, getByTestId } = render(
      <PoolseTheme theme="ocean" colorScheme="dark">
        <Probe />
      </PoolseTheme>,
    );
    const el = wrapper(container);
    const c = BUILT_IN_THEMES.ocean.dark.colors;
    expect(el.style.getPropertyValue('--poolse-accent')).toBe(c.accent);
    expect(el.style.getPropertyValue('--poolse-brand')).toBe(c.accent);
    expect(el.style.getPropertyValue('--poolse-own-bubble')).toBe(c.ownBubble);
    expect(el.dataset.theme).toBe('dark');
    expect(el.dataset.poolseTheme).toBe('ocean');
    expect(document.documentElement.style.getPropertyValue('--poolse-accent')).toBe('');
    expect(getByTestId('probe').textContent).toBe('ocean/dark');
  });

  it('switches theme and scheme without remounting children', () => {
    const { container, rerender, getByTestId } = render(
      <PoolseTheme theme="coral" colorScheme="light">
        <Probe />
      </PoolseTheme>,
    );
    const el = wrapper(container);
    expect(el.style.getPropertyValue('--poolse-accent')).toBe(
      BUILT_IN_THEMES.coral.light.colors.accent,
    );

    rerender(
      <PoolseTheme theme="forest" colorScheme="dark">
        <Probe />
      </PoolseTheme>,
    );
    expect(wrapper(container)).toBe(el);
    expect(el.style.getPropertyValue('--poolse-background')).toBe(
      BUILT_IN_THEMES.forest.dark.colors.background,
    );
    expect(el.dataset.theme).toBe('dark');
    expect(getByTestId('probe').textContent).toBe('forest/dark');
    expect(mounts).toBe(1);
  });

  it('takes a custom Theme object', () => {
    const custom = createTheme({
      id: 'acme',
      name: 'Acme',
      tokens: { colors: { accent: '#0a7d5a' } },
    });
    const { container } = render(<PoolseTheme theme={custom} colorScheme="light" />);
    expect(wrapper(container).style.getPropertyValue('--poolse-accent')).toBe('#0a7d5a');
    expect(wrapper(container).dataset.poolseTheme).toBe('acme');
  });

  it('follows the OS with colorScheme="system", live', () => {
    const system = stubSystemScheme(false);
    const { container, getByTestId } = render(
      <PoolseTheme theme="grape">
        <Probe />
      </PoolseTheme>,
    );
    const el = wrapper(container);
    expect(el.dataset.theme).toBe('light');
    act(() => system.set(true));
    expect(el.dataset.theme).toBe('dark');
    expect(el.style.getPropertyValue('--poolse-accent-soft')).toBe(
      BUILT_IN_THEMES.grape.dark.colors.accentSoft,
    );
    expect(getByTestId('probe').textContent).toBe('grape/dark');
    expect(mounts).toBe(1);
  });

  it('without a theme sets no variables, only the scheme (the stylesheet’s defaults)', () => {
    const { container, getByTestId } = render(
      <PoolseTheme colorScheme="dark">
        <Probe />
      </PoolseTheme>,
    );
    const el = wrapper(container);
    expect(el.getAttribute('style')).toBeNull();
    expect(el.dataset.theme).toBe('dark');
    expect(el.dataset.poolseTheme).toBeUndefined();
    expect(getByTestId('probe').textContent).toBe('none/dark');
  });

  it('useTheme outside a provider reports no theme', () => {
    stubSystemScheme(false);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe').textContent).toBe('none/light');
  });
});
