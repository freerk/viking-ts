import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  {
    files: [
      'packages/server/src/**/*.ts',
      'packages/server/test/**/*.ts',
      'packages/openclaw-plugin/src/**/*.ts',
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
