// node --test stale-rounds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { headAt, markStaleRounds } from './stale-rounds.mjs';

// A real PR's history: review submissions and the pushes that reached the remote.
const pushes = [
  { sha: 'a308c9f', at: '2026-10-15T18:10:00Z' },
  { sha: '3f4855d', at: '2026-10-15T18:26:00Z' },
  { sha: 'c10e460', at: '2026-10-15T18:36:42Z' },
  { sha: 'c32cc85', at: '2026-10-15T18:46:39Z' },
  { sha: '7b7d6c1', at: '2026-10-15T18:59:06Z' },
  { sha: 'c77b7dc', at: '2026-10-15T19:01:09Z' },
  { sha: 'fb44110', at: '2026-10-15T19:08:41Z' },
];
const rounds = [
  { n: 1, sha: 'a308c9f', at: '2026-10-15T18:19:09Z' },
  { n: 2, sha: '3f4855d', at: '2026-10-15T18:32:38Z' },
  { n: 3, sha: 'c10e460', at: '2026-10-15T18:42:57Z' },
  { n: 4, sha: 'c32cc85', at: '2026-10-15T18:54:37Z' },
  { n: 5, sha: '7b7d6c1', at: '2026-10-15T19:04:17Z' },
  { n: 6, sha: 'fb44110', at: '2026-10-15T19:12:11Z' },
];

test('round 5 landed on 7b7d6c1 after c77b7dc was pushed, and only round 5 is stale', () => {
  const marked = markStaleRounds(rounds, pushes);
  assert.deepEqual(
    marked.filter((r) => r.staleAtSubmit).map((r) => r.n),
    [5],
  );
});

test('the head at a moment is the latest push at or before it', () => {
  assert.equal(headAt(pushes, '2026-10-15T19:04:17Z'), 'c77b7dc');
  assert.equal(headAt(pushes, '2026-10-15T18:00:00Z'), null);
});

test('two rounds on one unchanged commit are both fresh', () => {
  const same = [
    { n: 1, sha: 'aaa', at: '2026-01-01T01:00:00Z' },
    { n: 2, sha: 'aaa', at: '2026-01-01T02:00:00Z' },
  ];
  const marked = markStaleRounds(same, [
    { sha: 'aaa', at: '2026-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(
    marked.map((r) => r.staleAtSubmit),
    [false, false],
  );
});

test('a round whose sha has no known push time is never marked', () => {
  const marked = markStaleRounds(
    [{ n: 1, sha: 'zzz', at: '2026-01-01T02:00:00Z' }],
    [{ sha: 'aaa', at: '2026-01-01T01:00:00Z' }],
  );
  assert.equal(marked[0].staleAtSubmit, false);
});
