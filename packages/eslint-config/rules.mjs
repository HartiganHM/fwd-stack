// The rules every fwd-stack project shares, whichever preset it starts from. A project's own
// guards (Concert Crawl's copy lint, The 99's hover-state rule) stay in that project's config,
// layered after these.
export const sharedTypeScriptRules = {
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/consistent-type-imports': 'error',
}

export const sharedIgnores = {
  ignores: [
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    // Feature worktrees live inside the repo; without this the main checkout lints every one.
    '.worktrees/**',
    '.claude/worktrees/**',
  ],
}
