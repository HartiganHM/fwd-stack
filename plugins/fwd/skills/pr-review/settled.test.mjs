// node --test settled.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isDeclinedIn,
  mentions,
  parseDocSync,
  parseSettled,
} from './settled.mjs';

const body = (settled) =>
  `Summary.\n\n## Settled\n\n${settled}\n\n## Size\n\nlater section \`other.ts\` round 9\n`;

test("a bare entry for round 1 does not discount round 3's new High on the same file", () => {
  const settled = parseSettled(
    body(
      '**`src/lib/orders/fill.ts` — "add a fallback line item…"** Correct, and ruled as the next PR.',
    ),
  );
  const rounds = [
    { n: 1, paths: ['src/lib/orders/fill.ts'] },
    { n: 2, paths: ['src/app/orders/actions.ts'] },
    { n: 3, paths: ['src/lib/orders/fill.ts'] },
  ];
  assert.equal(
    isDeclinedIn(settled, 'src/lib/orders/fill.ts', 1, rounds),
    true,
  );
  assert.equal(
    isDeclinedIn(settled, 'src/lib/orders/fill.ts', 3, rounds),
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
      "- **(round 3) `src/lib/catalog/seed-index.ts`: a run killed between the clear and the rebuild…** Declined. That publish deletes them in its own transaction (round 2's fix).",
    ),
  );
  const rounds = [1, 2, 3].map((n) => ({
    n,
    paths: ['src/lib/catalog/seed-index.ts'],
  }));
  const on = (n) =>
    isDeclinedIn(settled, 'src/lib/catalog/seed-index.ts', n, rounds);
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

test('a line naming the same file twice is still one decline', () => {
  const twice = parseSettled(
    body('- (round 1) `a.tsx`: declined; see `a.tsx` line 40 for why.'),
  );
  const rounds = [{ n: 1, paths: ['src/a.tsx'], findings: { 'src/a.tsx': 2 } }];
  assert.equal(isDeclinedIn(twice, 'src/a.tsx', 1, rounds), false);
});

test('a shell script can be settled', () => {
  const settled = parseSettled(
    body('- (round 2) `scripts/gate-hook.sh`: declined, by design.'),
  );
  assert.equal(mentions(settled, 'scripts/gate-hook.sh'), true);
  const rounds = [
    {
      n: 2,
      paths: ['scripts/gate-hook.sh'],
      findings: { 'scripts/gate-hook.sh': 1 },
    },
  ];
  assert.equal(isDeclinedIn(settled, 'scripts/gate-hook.sh', 2, rounds), true);
});

test('a path counts whatever its extension, and extensionless build files count by name', () => {
  const settled = parseSettled(
    body(
      '- (round 1) `Cargo.toml`, `apps/crawler/Dockerfile`, `Dockerfile` and `infra/main.go`: declined.',
    ),
  );
  for (const p of [
    'Cargo.toml',
    'apps/crawler/Dockerfile',
    'Dockerfile',
    'infra/main.go',
  ])
    assert.equal(mentions(settled, p), true, p);
});

test('a slashed path keeps its parentheses, a call does not count', () => {
  const settled = parseSettled(
    body('- (round 1) `src/app/(auth)/page.tsx` and `render()`: declined.'),
  );
  assert.equal(mentions(settled, 'src/app/(auth)/page.tsx'), true);
  assert.equal(settled.size, 1);
});

// ---- ## Doc-sync ------------------------------------------------------------
// Doc-sync used to be a flat set: listing a file discounted every later round's
// findings on it, and one PR read eight trailing clean rounds where two were.

const docSyncBody = (lines) =>
  `Summary.\n\n## Doc-sync\n\n${lines}\n\n## Settled\n\n- \`other.ts\` (round 1): no.\n`;

test('a doc-sync entry naming round 2 does not hide rounds 3 to 8 on the same file', () => {
  const docSync = parseDocSync(
    docSyncBody('- `src/lib/gate.mjs` (round 2): stale JSDoc fixed.'),
  );
  const rounds = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    n,
    paths: n === 1 ? [] : ['src/lib/gate.mjs'],
  }));
  assert.equal(isDeclinedIn(docSync, 'src/lib/gate.mjs', 2, rounds), true);
  for (const n of [3, 4, 5, 6, 7, 8]) {
    assert.equal(
      isDeclinedIn(docSync, 'src/lib/gate.mjs', n, rounds),
      false,
      `round ${n} must count`,
    );
  }
});

test('a bare doc-sync entry covers only the first round that flagged the file', () => {
  const docSync = parseDocSync(
    docSyncBody('- `gate.mjs`: comment named the old flag.'),
  );
  const rounds = [
    { n: 1, paths: ['src/a.ts'] },
    { n: 2, paths: ['src/lib/gate.mjs'] },
    { n: 3, paths: ['src/lib/gate.mjs'] },
  ];
  assert.equal(isDeclinedIn(docSync, 'src/lib/gate.mjs', 2, rounds), true);
  assert.equal(isDeclinedIn(docSync, 'src/lib/gate.mjs', 3, rounds), false);
});

test('a doc-sync line answers one finding, not every finding that round', () => {
  const docSync = parseDocSync(
    docSyncBody('- `src/a.tsx` (round 1): PR body named the wrong prop.'),
  );
  const rounds = [{ n: 1, paths: ['src/a.tsx'], findings: { 'src/a.tsx': 2 } }];
  assert.equal(isDeclinedIn(docSync, 'src/a.tsx', 1, rounds), false);
});

test('doc-sync listing a round range covers each round in it, and no file it does not name', () => {
  const docSync = parseDocSync(
    docSyncBody('- `src/a.tsx` (rounds 2-3): stale comment re-raised.'),
  );
  const rounds = [2, 3, 4].map((n) => ({
    n,
    paths: ['src/a.tsx', 'src/b.tsx'],
  }));
  assert.equal(isDeclinedIn(docSync, 'src/a.tsx', 2, rounds), true);
  assert.equal(isDeclinedIn(docSync, 'src/a.tsx', 3, rounds), true);
  assert.equal(isDeclinedIn(docSync, 'src/a.tsx', 4, rounds), false);
  assert.equal(isDeclinedIn(docSync, 'src/b.tsx', 2, rounds), false);
});

test('doc-sync and settled read their own sections only', () => {
  const body = docSyncBody('- `src/a.tsx` (round 1): stale comment.');
  assert.equal(mentions(parseDocSync(body), 'other.ts'), false);
  assert.equal(mentions(parseSettled(body), 'src/a.tsx'), false);
});
