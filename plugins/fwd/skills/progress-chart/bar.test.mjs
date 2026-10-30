// node --test bar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bar, cells, WIDTH } from './bar.mjs';

test('every bar is exactly 20 cells, for every count up to 40 steps', () => {
  for (let total = 1; total <= 40; total++) {
    for (let done = 0; done <= total; done++) {
      for (let inFlight = 0; done + inFlight <= total; inFlight++) {
        const c = cells(done, inFlight, total);
        assert.equal(c[0] + c[1] + c[2], WIDTH, `${done}/${inFlight}/${total}`);
        assert.equal([...bar(done, inFlight, total)].length, WIDTH);
        // No segment strays more than one cell from its exact share.
        [done, inFlight, total - done - inFlight].forEach((n, i) =>
          assert.ok(
            Math.abs(c[i] - (n * WIDTH) / total) < 1,
            `${done}/${inFlight}/${total}`,
          ),
        );
      }
    }
  }
});

test('plain rounding when it already totals 20', () => {
  assert.deepEqual(cells(5, 1, 11), [9, 2, 9]);
  assert.equal(bar(2, 0, 11), '████░░░░░░░░░░░░░░░░');
});

test('an overflow comes off not started first, so a tie never overstates progress', () => {
  // 6.67 each rounds to 7 + 7 + 7 = 21.
  assert.deepEqual(cells(2, 2, 2 + 2 + 2), [7, 7, 6]);
  // 2.5 + 2.5 + 15 rounds to 3 + 3 + 15 = 21; not started was exact, so in flight gives one up.
  assert.deepEqual(cells(1, 1, 8), [3, 2, 15]);
});

test('empty and full lines', () => {
  assert.equal(bar(0, 0, 7), '░'.repeat(20));
  assert.equal(bar(7, 0, 7), '█'.repeat(20));
});

test('bad counts are refused', () => {
  assert.throws(() => cells(1, 0, 0));
  assert.throws(() => cells(3, 3, 5));
  assert.throws(() => cells(-1, 0, 5));
  assert.throws(() => cells(1.5, 0, 5));
});
