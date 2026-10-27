// node --test settled.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDeclinedIn, mentions, parseSettled } from './settled.mjs';

const body = (settled) =>
  `Summary.\n\n## Settled\n\n${settled}\n\n## Size\n\nlater section \`other.ts\` round 9\n`;

test("a bare entry for round 1 does not discount round 3's new High on the same file", () => {
  const settled = parseSettled(
    body(
      '**`src/lib/decks/fill.ts` — "inject a canonical basic…"** Correct, and ruled as the next PR.',
    ),
  );
  const rounds = [
    { n: 1, paths: ['src/lib/decks/fill.ts'] },
    { n: 2, paths: ['src/app/decks/actions.ts'] },
    { n: 3, paths: ['src/lib/decks/fill.ts'] },
  ];
  assert.equal(isDeclinedIn(settled, 'src/lib/decks/fill.ts', 1, rounds), true);
  assert.equal(
    isDeclinedIn(settled, 'src/lib/decks/fill.ts', 3, rounds),
    false,
  );
});

test("an entry scoped to round 2 does not discount round 4's Critical", () => {
  const settled = parseSettled(
    body(
      '- `src/lib/recs/store.ts` (round 2): duplicate of round 1, declined.',
    ),
  );
  const rounds = [1, 2, 3, 4].map((n) => ({
    n,
    paths: n === 3 ? [] : ['src/lib/recs/store.ts'],
  }));
  assert.equal(isDeclinedIn(settled, 'src/lib/recs/store.ts', 2, rounds), true);
  // "round 1" is prose after the declaration, so it is not settled.
  assert.equal(
    isDeclinedIn(settled, 'src/lib/recs/store.ts', 1, rounds),
    false,
  );
  assert.equal(
    isDeclinedIn(settled, 'src/lib/recs/store.ts', 4, rounds),
    false,
  );
});

test('the §6 escape valve: a wrong finding repeated as a new comment is discounted once its round is added', () => {
  const settled = parseSettled(
    body(
      '- `novelty.ts` — rounds 3, 5 and 7-8: the surface is tested; see the five mutation-checked cases.',
    ),
  );
  const rounds = [3, 4, 5, 6, 7, 8].map((n) => ({
    n,
    paths: ['src/lib/discovery/novelty.ts'],
  }));
  const on = (n) =>
    isDeclinedIn(settled, 'src/lib/discovery/novelty.ts', n, rounds);
  assert.deepEqual([3, 4, 5, 6, 7, 8].map(on), [
    true,
    false,
    true,
    false,
    true,
    true,
  ]);
});

test('a path named bare on one line and scoped on another keeps the scope', () => {
  const settled = parseSettled(
    body('- `a.ts` (round 2): wrong.\n- see also `a.ts` in the plan.'),
  );
  assert.deepEqual([...settled.get('a.ts')], [2]);
});

test('a bare entry on a file no round has flagged discounts nothing', () => {
  const settled = parseSettled(body('- `a.ts`: deferred.'));
  assert.equal(
    isDeclinedIn(settled, 'src/a.ts', 1, [{ n: 1, paths: ['src/b.ts'] }]),
    false,
  );
});

test('only the Settled section is read, and mentions() ignores rounds', () => {
  const settled = parseSettled(body('- `a.ts` round 1.'));
  assert.equal(mentions(settled, 'src/x/a.ts'), true);
  assert.equal(mentions(settled, 'other.ts'), false);
});

test('an API call in backticks is not a path', () => {
  assert.equal(parseSettled(body('`page.evaluate` round 2')).size, 0);
});

test("a round named in the entry's prose is not part of its declaration", () => {
  const settled = parseSettled(
    body(
      "- **(round 3) `src/lib/edhrec/seed-index.ts`: a run killed between the first clear and the role pass…** Declined. That publish deletes them in its own transaction (round 2's fix).",
    ),
  );
  const rounds = [1, 2, 3].map((n) => ({
    n,
    paths: ['src/lib/edhrec/seed-index.ts'],
  }));
  const on = (n) =>
    isDeclinedIn(settled, 'src/lib/edhrec/seed-index.ts', n, rounds);
  assert.deepEqual([1, 2, 3].map(on), [false, false, true]);
});

test('a decline answers ONE finding, not every finding the round raised on that file', () => {
  const settled = parseSettled(
    body(
      '- **None of these after a Normal add (round 1):** `add-cards-sheet.tsx`. Shipped rule.',
    ),
  );
  const rounds = [
    {
      n: 1,
      paths: ['src/add-cards-sheet.tsx'],
      findings: { 'src/add-cards-sheet.tsx': 2 },
    },
  ];
  // The round also raised a separate Medium on the same file that was fixed, not declined.
  assert.equal(
    isDeclinedIn(settled, 'src/add-cards-sheet.tsx', 1, rounds),
    false,
  );
});

test('one decline per finding discounts a round that raised exactly that many', () => {
  const two = parseSettled(
    body(
      '- (round 1) `a.tsx`: first, declined.\n- (round 1) `a.tsx`: second, declined.',
    ),
  );
  const rounds = [{ n: 1, paths: ['src/a.tsx'], findings: { 'src/a.tsx': 2 } }];
  assert.equal(isDeclinedIn(two, 'src/a.tsx', 1, rounds), true);
  const one = parseSettled(body('- (round 1) `a.tsx`: first, declined.'));
  assert.equal(isDeclinedIn(one, 'src/a.tsx', 1, rounds), false);
});
