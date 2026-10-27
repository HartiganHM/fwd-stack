// node --test rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diminishingReturns, findingsIn } from './rounds.mjs';

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
