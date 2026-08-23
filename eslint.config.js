import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // .claude/worktrees holds live checkouts for parallel stream agents. Linting
  // them from the main checkout reports another agent's in-progress code as this
  // one's failure, and the files vanish mid-run when an agent finishes.
  { ignores: ['dist', 'coverage', 'dev-dist', 'node_modules', '.claude/worktrees'] },
  js.configs.recommended,
  {
    // Type-aware linting only where a tsconfig actually covers the file.
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/ui/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The generator must never touch React, the DOM, or the clock.
    files: ['src/core/**/*.ts', 'src/harness/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must stay environment-free (ADR-0004).' },
        { name: 'document', message: 'src/core must stay environment-free (ADR-0004).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', '**/ui/**', '**/render/**', '**/game/**'],
              message: 'src/core must not depend on UI, rendering, or game state (ADR-0004).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use createRng() from src/core/rng.ts — boards must be deterministic.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'src/core must be a pure function of (seed, params).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'scripts/**/*', 'src/harness/**/*'],
    rules: { 'no-console': 'off' },
  },
);
