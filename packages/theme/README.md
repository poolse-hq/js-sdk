# @poolse/theme

Design tokens and built-in themes for the poolse UI packages. Plain data and
pure functions with no dependencies — `@poolse/react-ui` and
`@poolse/react-native` use it, and so can your own UI.

```bash
npm install @poolse/theme
```

You don't need to use this package directly to theme the prebuilt
components: pass `theme` and `colorScheme` to `<PoolseTheme>` from
`@poolse/react-ui` or `@poolse/react-native`.

## Themes

Every theme has a light and a dark set of tokens.

| id       | Light accent | Dark accent |
| -------- | ------------ | ----------- |
| `coral`  | `#d9381a`    | `#d9381a`   |
| `ocean`  | `#0b63c4`    | `#1d6fd6`   |
| `forest` | `#1f7a3f`    | `#1f7a3f`   |
| `grape`  | `#7c3aed`    | `#7c3aed`   |
| `slate`  | `#475569`    | `#4b5d78`   |
| `sunset` | `#c2410c`    | `#c2410c`   |
| `rose`   | `#c81e5b`    | `#c81e5b`   |
| `mono`   | `#1a1a1a`    | `#f2f2f2`   |

`coral` is the default. Every text-bearing colour pair (see
`CONTRAST_PAIRS`) reaches WCAG AA, 4.5:1, in both schemes.

## Tokens

- **colors** — `background`, `surface`, `surfaceAlt`, `text`, `textMuted`,
  `textSubtle`, `border`, `accent`, `accentText`, `accentSoft`,
  `accentStrong`, `link`, `sidebar`, `sidebarText`, `sidebarActive`,
  `sidebarActiveText`, `badge`, `badgeText`, `mention`, `mentionText`, `danger`, `warning`,
  `success`, `info`, `presence`, `ownBubble`, `ownBubbleText`, `otherBubble`,
  `otherBubbleText`, `overlay`
- **fonts** — `body`, `display`, `mono`, `sizeXs`, `sizeSm`, `sizeMd`,
  `sizeLg`, `sizeXl` (px), `lineHeight` (multiplier)
- **radii** — `sm`, `md`, `lg`, `xl`, `pill`, `bubble` (px)
- **spacing** — `xs`, `sm`, `md`, `lg`, `xl` (px)
- **shadows** — `sm`, `md`, `lg`

## Web

```ts
import { toCssVariables, toCssText } from '@poolse/theme';

toCssVariables('ocean', 'dark'); // { '--poolse-accent': '#1d6fd6', … }
toCssText('ocean', 'dark', '[data-theme="dark"]'); // a CSS rule
```

Each token becomes `--poolse-<token>` (`accentText` → `--poolse-accent-text`,
`fonts.sizeMd` → `--poolse-font-size-md`, `radii.bubble` →
`--poolse-radius-bubble`, `spacing.md` → `--poolse-space-md`). The names
`@poolse/react-ui`'s stylesheet reads (`--poolse-brand`, `--poolse-ink`,
`--poolse-paper`, …) are set as well; pass `{ legacy: false }` to leave them
out.

## React Native

```ts
import { toNativeTheme } from '@poolse/theme';

const t = toNativeTheme('forest', 'light', { fonts: { body: 'Inter' } });
// t.colors.accent, t.fonts.lineHeight (px), t.shadows.md (a style object)
```

Fonts default to the platform's (`System`, `Menlo`); pass the names you loaded
with expo-font to use your own.

## Custom themes and theme codes

```ts
import { createTheme, encodeTheme, decodeTheme, contrastIssues } from '@poolse/theme';

const acme = createTheme({
  id: 'acme',
  name: 'Acme',
  extends: 'ocean',
  light: { colors: { accent: '#0a7d5a' } },
});
contrastIssues(acme); // [] when every pair reaches 4.5:1

const code = encodeTheme(acme); // 'pt1.eyJpIjoi…'
decodeTheme(code); // the same theme; throws ThemeCodeError on a bad code
```

A code is `pt<version>.` plus base64url JSON holding only the tokens that
differ from the built-in theme it extends. `decodeTheme` rejects unknown
versions, unknown fields, malformed colours, out-of-range numbers and font
names that could break out of a CSS declaration.

## License

[poolse SDK License](./LICENSE).
