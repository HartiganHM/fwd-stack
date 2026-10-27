// node --test classify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDoc, isDocOnly, isGenerated, isToolingConfig } from './classify.mjs';

const handoff = [
  'design/design_handoff_app_nav_labels/README.md',
  'design/design_handoff_app_nav_labels/ShellFrame.dc.html',
  'design/design_handoff_app_nav_labels/art/hero-master.png',
  'design/design_handoff_app_nav_labels/support.js',
];

test('a design/-only handoff PR is doc-only', () => {
  assert.equal(isDocOnly(handoff), true);
});

test('a design/ plus src/ PR is not doc-only', () => {
  assert.equal(isDocOnly([...handoff, 'src/components/shell/nav.tsx']), false);
});

test('docs alone stay doc-only, and an empty file list is not', () => {
  assert.equal(isDocOnly(['docs/superpowers/plans/x.md', 'AGENTS.md']), true);
  assert.equal(isDocOnly([]), false);
});

test('configuration JSON is not documentation', () => {
  assert.equal(isDoc('package.json'), false);
  assert.equal(isDoc('plugins/fwd/hooks/hooks.json'), false);
  assert.equal(isDocOnly(['package.json', 'README.md']), false);
  assert.equal(isDoc('docs/data/table.json'), true);
});

test('migration snapshots and lockfiles are generated, source is not', () => {
  assert.equal(isGenerated('drizzle/meta/0178_snapshot.json'), true);
  assert.equal(isGenerated('packages/db/drizzle/meta/_journal.json'), true);
  assert.equal(isGenerated('pnpm-lock.yaml'), true);
  assert.equal(isGenerated('drizzle/0178_add_column.sql'), false);
  assert.equal(isGenerated('src/lib/meta/x.json'), false);
});

test('build configuration is tooling config, so a script-plus-config PR is a tooling PR', () => {
  for (const p of [
    'tsconfig.json',
    'packages/x/tsconfig.build.json',
    'package.json',
    'eslint.config.mjs',
    '.prettierrc.json',
    'vitest.config.ts',
    '.github/workflows/ci.yml',
  ])
    assert.equal(isToolingConfig(p), true, p);
  for (const p of [
    'src/app/page.tsx',
    'src/data/config.json',
    'scripts/check.mjs',
  ])
    assert.equal(isToolingConfig(p), false, p);
});
