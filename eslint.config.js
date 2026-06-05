import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Build output, deps, and relocated one-off debug scripts are not linted.
  { ignores: ['dist', 'build', 'coverage', 'node_modules', 'scripts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Frontend (browser + React)
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // The two classic hook rules. (The plugin's newer experimental rules are
      // intentionally left off to keep the baseline actionable.)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Backend (Node)
  {
    files: ['server.ts', 'lib/**/*.ts', 'api/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Project-wide rule tuning. Pre-existing patterns (loose `any`, intentional
  // throwaway vars) are downgraded to warnings so the lint baseline stays green
  // and CI fails only on genuine errors. Tightening these is tracked as later
  // type-safety cleanup.
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Re-throwing without { cause } is fine for this app's fallback flows.
      'preserve-caught-error': 'off',
    },
  },

  // Disables stylistic rules that would conflict with Prettier. Must be last.
  prettier
);
