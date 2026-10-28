// node --test session-budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  band,
  budgetMessage,
  crossed,
  lastContext,
  lines,
} from './session-budget.mjs';

const L = lines({});

test('the lines default to 150k and rotateAt, and follow the config', () => {
  assert.deepEqual(L, { warn: 150_000, critical: 300_000 });
  assert.deepEqual(
    lines({
      sessionBudget: { warnTokens: 80_000 },
      orchestrator: { rotateAt: 200_000 },
    }),
    { warn: 80_000, critical: 200_000 },
  );
});

test('quiet below the warning line, then a warning, then critical', () => {
  assert.equal(budgetMessage(null, L), null);
  assert.equal(budgetMessage(149_999, L), null);
  assert.match(budgetMessage(150_000, L), /WARNING.*~150k/);
  assert.match(budgetMessage(312_000, L), /CRITICAL.*~312k.*rotate/);
});

test('bands: one for the warning, one for critical, then one per 100k past it', () => {
  assert.deepEqual(
    [0, 149_999, 150_000, 299_999, 300_000, 399_999, 400_000, 780_000].map(
      (c) => band(c, L),
    ),
    [0, 0, 1, 1, 2, 2, 3, 6],
  );
});

test('a session is told once per band crossed, never again for the same band', () => {
  const env = { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'budget-')) };
  assert.equal(crossed('s1', 1, env), true);
  assert.equal(crossed('s1', 1, env), false);
  assert.equal(crossed('s1', 2, env), true);
  assert.equal(crossed('s1', 2, env), false);
  assert.equal(crossed('s2', 1, env), true, 'sessions are tracked apart');
  assert.equal(crossed('s1', 0, env), false, 'a compacted session drops back');
  assert.equal(crossed('s1', 1, env), true, 'and is warned again as it grows');
});

test('context is the last main-session turn, read from the tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  const file = join(dir, 't.jsonl');
  const turn = (input, cached, extra = {}) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id: String(input),
        usage: {
          input_tokens: input,
          cache_read_input_tokens: cached,
          cache_creation_input_tokens: 0,
        },
      },
      ...extra,
    });
  writeFileSync(
    file,
    [
      turn(10, 100_000),
      turn(20, 250_000),
      turn(5, 900_000, { isSidechain: true }),
      'x'.repeat(3 * 1024 * 1024),
      '{"type":"user"}',
    ].join('\n'),
  );
  assert.equal(
    lastContext(file),
    250_020,
    'a subagent turn does not count; a big tool result is read past',
  );
});
