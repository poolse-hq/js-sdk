import { describe, expect, it } from 'vitest';
import {
  contrastIssues,
  contrastRatio,
  ensureContrast,
  mixColors,
  themeFromBrand,
} from '../src/index.js';

describe('themeFromBrand (AD15)', () => {
  const brands = ['#0a7d5a', '#ffd400', '#1a1a1a', '#ff66cc', '#00b3ff', '#ffffff', '#7c3aed'];
  it.each(brands)('passes WCAG AA for primary %s in both schemes', (primary) => {
    const t = themeFromBrand({ primary, accent: '#00b3ff' }, { name: 'Acme' });
    expect(contrastIssues(t)).toEqual([]);
    expect(t.name).toBe('Acme');
  });

  it('keeps a readable brand colour as is and uses the background when it fits', () => {
    const t = themeFromBrand({ primary: '#0b63c4', background: '#f7f9ff' });
    expect(t.light.colors.accent).toBe('#0b63c4');
    expect(t.light.colors.background).toBe('#f7f9ff');
    const dark = themeFromBrand({ primary: '#0b63c4', background: '#222222' });
    expect(dark.light.colors.background).not.toBe('#222222');
  });

  it('falls back on invalid colours', () => {
    const t = themeFromBrand({ primary: 'blue', accent: 'nope' });
    expect(contrastIssues(t)).toEqual([]);
  });

  it('mixes and fixes contrast', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    const c = ensureContrast('#ffd400', '#ffffff');
    expect(contrastRatio(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast('#111111', '#ffffff')).toBe('#111111');
  });
});
