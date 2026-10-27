// node --test session-budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { budgetMessage } from './session-budget.mjs';

test('quiet below the warning, then a warning, then critical', () => {
  assert.equal(budgetMessage(19), null);
  assert.match(budgetMessage(20), /WARNING/);
  assert.match(budgetMessage(35), /CRITICAL/);
});

test('thresholds come from the config when set', () => {
  assert.equal(budgetMessage(25, { warn: 30, critical: 60 }), null);
  assert.match(budgetMessage(60, { warn: 30, critical: 60 }), /CRITICAL/);
});
