import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { sharedIgnores, sharedTypeScriptRules } from './rules.mjs';

// eslint-config-next registers typescript-eslint itself, so this preset adds the shared rules on
// top of it rather than starting from base.mjs (which would register the plugin twice).
/** @type {import('eslint').Linter.Config[]} */
export default [
  sharedIgnores,
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: sharedTypeScriptRules,
  },
];
