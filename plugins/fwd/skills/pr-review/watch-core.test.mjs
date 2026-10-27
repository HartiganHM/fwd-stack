// node --test watch-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describe,
  initialState,
  primeState,
  watchStep,
  fitsAnotherPoll,
} from './watch-core.mjs';

// A real PR's history (2026-10-15, UTC): pushes, Copilot's two reviews and each head's CI run.
const E21 = 'e21dfb2a895b159cdcfb602fcbce18e84fec12b0';
const C67 = 'c6740c1d2911e9519869c52912997c2f2a8734e5';
const pushes = [
  { sha: E21, at: '2026-10-15T20:33:36Z' },
  { sha: C67, at: '2026-10-15T20:53:44Z' }, // force push after round 1; re-requested 20:54:16
];
const reviews = [
  {
    id: 5539606171,
    commit_id: E21,
    submitted_at: '2026-10-15T20:40:09Z',
    body: '',
  },
  {
    id: 5539880580,
    commit_id: C67,
    submitted_at: '2026-10-15T21:01:24Z',
    body: '',
  },
];
const runs = [
  {
    head_sha: E21,
    name: 'CI',
    conclusion: 'success',
    created: '2026-10-15T20:33:36Z',
    done: '2026-10-15T20:42:52Z',
  },
  {
    head_sha: C67,
    name: 'CI',
    conclusion: 'success',
    created: '2026-10-15T20:53:49Z',
    done: '2026-10-15T21:03:48Z',
  },
];

/** What the PR looked like at `t`, as the API would have answered then. */
function snapshotAt(t) {
  const head = pushes.filter((p) => p.at <= t).at(-1).sha;
  return {
    state: 'open',
    head,
    reviews: reviews.filter((r) => r.submitted_at <= t),
    ciRuns: runs
      .filter((r) => r.created <= t)
      .map((r) => ({
        head_sha: r.head_sha,
        name: r.name,
        status: r.done <= t ? 'completed' : 'in_progress',
        conclusion: r.done <= t ? r.conclusion : null,
      })),
  };
}

/** Polls every 45s from `from` to `to`, as the runner does. */
function times(from, to) {
  const out = [];
  for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 45_000)
    out.push(new Date(ms).toISOString().replace('.000', ''));
  return out;
}

test('a watcher armed before round 1 wakes on round 1, its CI, round 2 and its CI', () => {
  let state = primeState(snapshotAt('2026-10-15T20:34:00Z'));
  const seen = [];
  for (const t of times('2026-10-15T20:34:00Z', '2026-10-15T21:10:00Z')) {
    const out = watchStep(state, snapshotAt(t));
    state = out.state;
    seen.push(...out.events.map((e) => describe(101, e)));
  }
  assert.deepEqual(seen, [
    '#101 review round 1 landed on the head e21dfb2: run pr-gate.mjs 101, then triage',
    '#101 CI passed on e21dfb2',
    '#101 review round 2 landed on the head c6740c1: run pr-gate.mjs 101, then triage',
    '#101 CI passed on c6740c1',
  ]);
});

test('the one-shot watcher lanes armed (count rises, then exit) wakes once where the shipped one wakes twice', () => {
  const from = '2026-10-15T20:34:00Z';
  const to = '2026-10-15T21:10:00Z';
  const n0 = snapshotAt(from).reviews.length;
  let oneShot = 0;
  for (const t of times(from, to)) {
    if (snapshotAt(t).reviews.length > n0) {
      oneShot += 1;
      break; // `until [ count -gt n0 ]; do sleep; done` exits here
    }
  }
  let state = primeState(snapshotAt(from));
  let shipped = 0;
  for (const t of times(from, to)) {
    const out = watchStep(state, snapshotAt(t));
    state = out.state;
    shipped += out.events.filter((e) => e.type === 'review').length;
  }
  assert.equal(oneShot, 1);
  assert.equal(shipped, 2);
});

test('the deadline leaves room for a whole poll, reads included', () => {
  const deadline = 29 * 60_000;
  assert.equal(fitsAnotherPoll(0, deadline, 45_000), true);
  // 28:00 + 45s sleep + 30s of reads ends at 29:15, past a 29:00 deadline.
  assert.equal(fitsAnotherPoll(28 * 60_000, deadline, 45_000), false);
  assert.equal(fitsAnotherPoll(27 * 60_000, deadline, 45_000), true);
});

test('a review of a head already pushed past is reported STALE, not fresh', () => {
  const snap = {
    state: 'open',
    head: C67,
    reviews: [{ id: 1, commit_id: E21, submitted_at: '2026-10-15T21:00:00Z' }],
    ciRuns: [],
  };
  const { events } = watchStep(initialState(), snap);
  assert.equal(events[0].kind, 'stale');
  assert.match(describe(1, events[0]), /STALE/);
});

test('an errored review is reported as errored, and the PR merging ends the watch once', () => {
  const snap = {
    state: 'open',
    head: C67,
    reviews: [
      {
        id: 1,
        commit_id: C67,
        submitted_at: 't',
        body: 'Copilot encountered an error',
      },
    ],
    ciRuns: [],
  };
  let { state, events } = watchStep(initialState(), snap);
  assert.equal(events[0].kind, 'errored');
  ({ state, events } = watchStep(state, { ...snap, state: 'merged' }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['end'],
  );
  assert.deepEqual(watchStep(state, { ...snap, state: 'merged' }).events, []);
});

test("a failed CI names the failing jobs, and a head's CI is reported once", () => {
  const snap = {
    state: 'open',
    head: C67,
    reviews: [],
    ciRuns: [
      {
        head_sha: C67,
        name: 'test (1)',
        status: 'completed',
        conclusion: 'failure',
      },
      {
        head_sha: C67,
        name: 'static',
        status: 'completed',
        conclusion: 'success',
      },
    ],
  };
  const first = watchStep(initialState(), snap);
  assert.equal(
    describe(9, first.events[0]),
    '#9 CI FAILED on c6740c1: test (1)',
  );
  assert.deepEqual(watchStep(first.state, snap).events, []);
});
