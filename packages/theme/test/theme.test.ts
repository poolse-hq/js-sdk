import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEMES,
  BUILT_IN_THEME_IDS,
  CONTRAST_PAIRS,
  DEFAULT_THEME_ID,
  ThemeCodeError,
  contrastIssues,
  contrastRatio,
  createTheme,
  decodeTheme,
  encodeTheme,
  getTheme,
  resolveTheme,
  toCssText,
  toCssVariables,
  toNativeTheme,
  type ThemeTokens,
} from '../src/index.js';

const schemes = ['light', 'dark'] as const;

describe('built-in themes', () => {
  it('has eight themes, coral first and the default', () => {
    expect(BUILT_IN_THEME_IDS).toEqual([
      'coral',
      'ocean',
      'forest',
      'grape',
      'slate',
      'sunset',
      'rose',
      'mono',
    ]);
    expect(DEFAULT_THEME_ID).toBe('coral');
    expect(Object.keys(BUILT_IN_THEMES).sort()).toEqual([...BUILT_IN_THEME_IDS].sort());
  });

  it('gives every theme the same complete token set in both schemes', () => {
    const shape = (t: ThemeTokens) =>
      Object.fromEntries(Object.entries(t).map(([g, v]) => [g, Object.keys(v).sort()]));
    const reference = shape(BUILT_IN_THEMES.coral.light);
    for (const id of BUILT_IN_THEME_IDS) {
      const theme = BUILT_IN_THEMES[id];
      expect(theme.id).toBe(id);
      for (const scheme of schemes) {
        expect(shape(theme[scheme])).toEqual(reference);
        for (const [k, v] of Object.entries(theme[scheme].colors)) {
          expect(v, `${id}.${scheme}.${k}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
        }
      }
    }
  });

  describe.each(BUILT_IN_THEME_IDS)('%s', (id) => {
    it.each(schemes)('%s: text on surface and accentText on accent reach 4.5:1', (scheme) => {
      const c = BUILT_IN_THEMES[id][scheme].colors;
      expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
    });

    it('every text-bearing pair reaches 4.5:1 in both schemes', () => {
      const issues = contrastIssues(BUILT_IN_THEMES[id]).map(
        (i) => `${i.scheme} ${i.foreground}/${i.background} ${i.ratio.toFixed(2)}`,
      );
      expect(issues).toEqual([]);
    });
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('flags a failing pair', () => {
    const weak = createTheme({
      id: 'weak',
      name: 'Weak',
      tokens: { colors: { accent: '#ff5436', accentText: '#fbf7f4' } },
    });
    const issues = contrastIssues(weak);
    expect(issues.map((i) => [i.scheme, i.foreground])).toContainEqual(['light', 'accentText']);
    expect(CONTRAST_PAIRS).toContainEqual(['accentText', 'accent']);
  });
});

describe('resolveTheme / getTheme', () => {
  it('resolves an id to one scheme', () => {
    const r = resolveTheme('ocean', 'dark');
    expect(r.id).toBe('ocean');
    expect(r.scheme).toBe('dark');
    expect(r.colors.accent).toBe(BUILT_IN_THEMES.ocean.dark.colors.accent);
  });

  it('falls back to the default for an unknown id', () => {
    expect(getTheme('nope' as never).id).toBe('coral');
    expect(getTheme(undefined).id).toBe('coral');
  });

  it('createTheme overrides tokens per scheme on a base', () => {
    const t = createTheme({
      id: 'acme',
      name: 'Acme',
      extends: 'forest',
      tokens: { radii: { bubble: 4 } },
      dark: { colors: { accent: '#123456' } },
    });
    expect(t.extends).toBe('forest');
    expect(t.light.radii.bubble).toBe(4);
    expect(t.dark.radii.bubble).toBe(4);
    expect(t.dark.colors.accent).toBe('#123456');
    expect(t.light.colors.accent).toBe(BUILT_IN_THEMES.forest.light.colors.accent);
  });
});

describe('toCssVariables', () => {
  it('names a variable after every token', () => {
    const vars = toCssVariables('coral', 'light');
    const c = BUILT_IN_THEMES.coral.light.colors;
    expect(vars['--poolse-accent']).toBe(c.accent);
    expect(vars['--poolse-accent-text']).toBe(c.accentText);
    expect(vars['--poolse-surface-alt']).toBe(c.surfaceAlt);
    expect(vars['--poolse-own-bubble']).toBe(c.ownBubble);
    expect(vars['--poolse-font-size-md']).toBe('15px');
    expect(vars['--poolse-radius-bubble']).toBe('18px');
    expect(vars['--poolse-space-md']).toBe('12px');
    expect(vars['--poolse-shadow-sm']).toMatch(/^0px 1px 2px 0px rgba\(/);
    for (const key of Object.keys(c)) {
      const name = `--poolse-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      expect(vars[name], name).toBeDefined();
    }
  });

  it('sets the stylesheet’s original names unless told not to', () => {
    const c = BUILT_IN_THEMES.grape.dark.colors;
    const vars = toCssVariables('grape', 'dark');
    expect(vars['--poolse-brand']).toBe(c.accent);
    expect(vars['--poolse-on-brand']).toBe(c.accentText);
    expect(vars['--poolse-paper']).toBe(c.background);
    expect(vars['--poolse-ink-2']).toBe(c.textMuted);
    expect(toCssVariables('grape', 'dark', { legacy: false })['--poolse-brand']).toBeUndefined();
  });

  it('renders a rule', () => {
    const css = toCssText('mono', 'dark', '.x');
    expect(css.startsWith('.x {\n')).toBe(true);
    expect(css).toContain(`--poolse-accent: ${BUILT_IN_THEMES.mono.dark.colors.accent};`);
  });
});

describe('toNativeTheme', () => {
  it('is a plain object of React Native values', () => {
    const t = toNativeTheme('sunset', 'light');
    expect(t.id).toBe('sunset');
    expect(t.colors.accent).toBe(BUILT_IN_THEMES.sunset.light.colors.accent);
    expect(t.fonts.body).toBe('System');
    expect(t.fonts.lineHeight).toBe(23);
    expect(t.shadows.md).toMatchObject({
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 15,
      elevation: 6,
    });
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });

  it('takes the app’s own font names', () => {
    expect(toNativeTheme('coral', 'dark', { fonts: { body: 'Inter' } }).fonts.body).toBe('Inter');
  });
});

describe('encodeTheme / decodeTheme', () => {
  it('round-trips every built-in theme in a few characters', () => {
    for (const id of BUILT_IN_THEME_IDS) {
      const code = encodeTheme(BUILT_IN_THEMES[id]);
      expect(code).toMatch(/^pt1\.[A-Za-z0-9_-]+$/);
      expect(code.length).toBeLessThan(60);
      expect(decodeTheme(code)).toEqual(BUILT_IN_THEMES[id]);
    }
  });

  it('round-trips a custom theme as its differences only', () => {
    const t = createTheme({
      id: 'acme-2',
      name: 'Acme — Nacht ☾',
      extends: 'ocean',
      tokens: { fonts: { body: "'Inter', sans-serif", sizeMd: 14 }, radii: { bubble: 6 } },
      light: { colors: { accent: '#0A7D5A', overlay: '#00000080' } },
      dark: { colors: { accent: '#0a7d5a' }, spacing: { md: 10 } },
    });
    const code = encodeTheme(t);
    expect(code.length).toBeLessThan(300);
    const back = decodeTheme(` ${code}\n`);
    expect(back.name).toBe('Acme — Nacht ☾');
    expect(back.light.colors.accent).toBe('#0a7d5a');
    expect(back.light.colors.overlay).toBe('#00000080');
    expect(back.light.fonts.body).toBe("'Inter', sans-serif");
    expect(back.dark.spacing.md).toBe(10);
    expect(back.light.radii.bubble).toBe(6);
    expect(back.light.colors.surface).toBe(BUILT_IN_THEMES.ocean.light.colors.surface);
  });

  it('round-trips a changed shadow', () => {
    const t = createTheme({
      id: 'flat',
      name: 'Flat',
      tokens: { shadows: { sm: { layers: [], elevation: 0 } } },
    });
    expect(decodeTheme(encodeTheme(t)).light.shadows.sm).toEqual({ layers: [], elevation: 0 });
  });

  const forge = (payload: unknown) =>
    `pt1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;

  it('accepts a hand-made code', () => {
    const t = decodeTheme(forge({ i: 'x', n: 'X', b: 'rose', l: { c: { accent: 'aa0044' } } }));
    expect(t.light.colors.accent).toBe('#aa0044');
    expect(t.extends).toBe('rose');
  });

  it.each([
    ['not a code', 'hello'],
    ['an empty payload', 'pt1.'],
    ['a future version', 'pt2.e30'],
    ['damaged base64', 'pt1.@@@'],
    ['not JSON', `pt1.${Buffer.from('{oops').toString('base64url')}`],
    ['an unknown base', forge({ i: 'x', n: 'X', b: 'neon' })],
    ['a bad id', forge({ i: 'X Y', n: 'X', b: 'coral' })],
    ['an empty name', forge({ i: 'x', n: ' ', b: 'coral' })],
    ['an unknown field', forge({ i: 'x', n: 'X', b: 'coral', z: 1 })],
    ['an unknown token', forge({ i: 'x', n: 'X', b: 'coral', l: { c: { nope: 'ffffff' } } })],
    ['a bad colour', forge({ i: 'x', n: 'X', b: 'coral', l: { c: { accent: 'red' } } })],
    [
      'CSS in a font name',
      forge({ i: 'x', n: 'X', b: 'coral', l: { f: { body: 'x; } body { color: red' } } }),
    ],
    ['a size out of range', forge({ i: 'x', n: 'X', b: 'coral', d: { f: { sizeMd: 400 } } })],
    ['a non-number radius', forge({ i: 'x', n: 'X', b: 'coral', d: { r: { lg: '9' } } })],
    ['a bad shadow', forge({ i: 'x', n: 'X', b: 'coral', l: { h: { sm: { layers: 3 } } } })],
    ['a huge code', `pt1.${'A'.repeat(9000)}`],
  ])('rejects %s', (_label, code) => {
    expect(() => decodeTheme(code)).toThrow(ThemeCodeError);
  });

  it('refuses to encode an invalid colour', () => {
    const t = createTheme({ id: 'x', name: 'X', tokens: { colors: { accent: 'blue' } } });
    expect(() => encodeTheme(t)).toThrow(ThemeCodeError);
  });
});

describe('tokensFromFlat', () => {
  it('keeps colour tokens with hex values and drops everything else', async () => {
    const { tokensFromFlat, createTheme } = await import('../src/index.js');
    const overrides = tokensFromFlat({
      accent: '#0b63c4',
      sidebar: '#123',
      mention: '#11223380',
      text: 'red', // not hex
      link: '#12345', // wrong length
      radiusBubble: '#ffffff', // not a colour token
      background: 42,
    });
    expect(overrides).toEqual({
      colors: { accent: '#0b63c4', sidebar: '#123', mention: '#11223380' },
    });

    const theme = createTheme({ id: 'mine', name: 'Mine', extends: 'coral', tokens: overrides });
    expect(theme.light.colors.accent).toBe('#0b63c4');
    expect(theme.light.colors.text).toBe(
      createTheme({ id: 'b', name: 'B', extends: 'coral' }).light.colors.text,
    );
  });

  it('returns {} for nothing usable', async () => {
    const { tokensFromFlat } = await import('../src/index.js');
    expect(tokensFromFlat(undefined)).toEqual({});
    expect(tokensFromFlat({ text: 'blue' })).toEqual({});
  });
});
