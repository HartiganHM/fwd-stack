// node --test classify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDocOnly } from './classify.mjs';

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
