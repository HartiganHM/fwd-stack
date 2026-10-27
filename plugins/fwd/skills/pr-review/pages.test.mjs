// node --test pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePages } from './pages.mjs';

test('several pages of arrays back to back join into one list', () => {
  assert.deepEqual(parsePages('[{"id":1},{"id":2}]\n[{"id":3}]'), [
    { id: 1 },
    { id: 2 },
    { id: 3 },
  ]);
});

test('an object endpoint comes back as a one-item list', () => {
  assert.deepEqual(parsePages('{"sha":"abc"}'), [{ sha: 'abc' }]);
});

test('brackets and escaped quotes inside strings do not split a page', () => {
  assert.deepEqual(parsePages('[{"body":"a ] \\" [ b"}]'), [
    { body: 'a ] " [ b' },
  ]);
});

test('empty output is an empty list', () => {
  assert.deepEqual(parsePages(''), []);
});
