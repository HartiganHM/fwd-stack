import node from '@fwd-stack/eslint-config/node';

export default [
  { ignores: ['**/node_modules/**'] },
  ...node,
  // The plugin's scripts are CLIs: printing to stdout is their output.
  { files: ['plugins/**/*.mjs'], rules: { 'no-console': 'off' } },
];
