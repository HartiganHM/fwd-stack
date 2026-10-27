// node --test rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { copyOnly, diminishingReturns, findingsIn } from './rounds.mjs';

const round = (findings) => ({ findings });

test('a round counts its findings, not the files they landed on', () => {
  assert.equal(findingsIn(round({ 'a.ts': 4 })), 4);
  assert.equal(findingsIn(round({ 'a.ts': 1, 'b.ts': 2 })), 3);
  assert.equal(findingsIn(round({})), 0);
});

test('four findings on one file do not read as one and grant the one-round bar', () => {
  const scored = [
    round({ 'x.ts': 2 }),
    round({}),
    round({}),
    round({ 'a.ts': 4 }),
  ];
  const d = diminishingReturns(scored, false);
  assert.equal(d.total, 4);
  assert.equal(d.applies, false);
});

test('at most one finding over the last three of four rounds applies', () => {
  const scored = [
    round({ 'x.ts': 2 }),
    round({}),
    round({ 'a.ts': 1 }),
    round({}),
  ];
  assert.equal(diminishingReturns(scored, false).applies, true);
  assert.equal(diminishingReturns(scored, true).applies, false);
  assert.equal(diminishingReturns(scored.slice(1), false).applies, false);
});

test('the copy-only bar reads every finding round from the streak breaker on', () => {
  const r = (n, count, paths) => ({ n, count, paths });
  const isCopy = (p) => p.startsWith('src/lib/copy/');
  const none = () => false;
  const copy = ['src/lib/copy/a.ts'];
  // A copy round, then a clean one: the breaker is the copy round.
  assert.equal(copyOnly([r(1, 1, copy), r(2, 0, [])], 1, isCopy, none), true);
  // A single successful round that still carried copy findings (suppressed-only).
  assert.equal(copyOnly([r(1, 1, copy)], 1, isCopy, none), true);
  // A substantive breaker keeps the full bar, whatever the streak carried.
  assert.equal(
    copyOnly([r(1, 2, ['src/x.ts']), r(2, 1, copy)], 1, isCopy, none),
    false,
  );
  // No findings at all is not copy-only.
  assert.equal(copyOnly([r(1, 0, [])], 1, isCopy, none), false);
  // A declined path counts as copy for its round.
  assert.equal(
    copyOnly([r(1, 1, ['src/y.ts'])], 0, isCopy, (p, n) => n === 1),
    true,
  );
});
