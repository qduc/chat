import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat();

export default [
  {
    ignores: ['node_modules'],
  },
  ...compat.extends('next'),
];