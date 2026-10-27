import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { sharedIgnores, sharedTypeScriptRules } from './rules.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  sharedIgnores,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: sharedTypeScriptRules,
  },
];
