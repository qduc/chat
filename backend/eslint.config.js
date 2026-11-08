// @ts-check

import globals from 'globals';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';
import path from 'path';
import { fileURLToPath } from 'url';

// mimic CommonJS variables -- not needed if using CommonJS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  {
    ignores: ['node_modules'],
  },
  js.configs.recommended,
  ...compat.extends('eslint-config-prettier'),
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['off', { argsIgnorePattern: '^_' }],
      // Allow empty catch blocks in tests/utilities where we intentionally swallow errors
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // TypeScript: parsed by typescript-eslint. Types are checked by `npm run typecheck`.
  ...tseslint.configs.recommended.map((cfg) => ({ ...cfg, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['__tests__/**/*.js', 'test_utils/**/*.js', 'integration/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
