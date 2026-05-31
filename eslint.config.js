// Flat config (ESLint 9). Minimal rules for now — we'll tighten as the
// SDK gets real consumers.
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '.pnpm-store/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      // SDK runs in both environments — fetch/Response/Request etc. come
      // from `browser`, setTimeout/AbortSignal/etc. from `node`.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      // Catches real hook bugs (deps array drift, conditional hooks,
      // hooks-in-loops). The packages/react source has matching
      // `// eslint-disable-next-line` comments where the rule is
      // intentionally bypassed (mount-once useMemo + dev-only effect).
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // no-undef is redundant with the TypeScript type-checker and
      // produces false positives on overloaded DOM lib types.
      'no-undef': 'off',
    },
  },
];
