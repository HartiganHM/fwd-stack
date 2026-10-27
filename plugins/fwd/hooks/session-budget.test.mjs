// node --test session-budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assistantTurns, budgetMessage } from './session-budget.mjs';

test('quiet below the warning, then a warning, then critical', () => {
  assert.equal(budgetMessage(19), null);
  assert.match(budgetMessage(20), /WARNING/);
  assert.match(budgetMessage(35), /CRITICAL/);
});

test('thresholds come from the config when set', () => {
  assert.equal(budgetMessage(25, { warn: 30, critical: 60 }), null);
  assert.match(budgetMessage(60, { warn: 30, critical: 60 }), /CRITICAL/);
});

test('a turn written as several transcript lines counts once', () => {
  const line = (id, type = 'assistant') =>
    JSON.stringify({ type, message: { id, role: type } });
  const jsonl = [
    line('a'),
    line('a'),
    line('b'),
    line('u1', 'user'),
    '{"type":"assis',
  ].join('\n');
  assert.equal(assistantTurns(jsonl), 2);
});
