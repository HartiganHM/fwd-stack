// node --test fix-scope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_COMPARE_FILES, fixPaths, fixWeight } from './fix-scope.mjs';

const isProduct = (p) => p.startsWith('src/');
const weigh = (over) =>
  fixWeight({
    anchorWeight: 'substantive',
    open: 1,
    describing: false,
    paths: [],
    isProduct,
    ...over,
  });

test('an ahead comparison lists the paths the fix changed, a rename on both sides', () => {
  assert.deepEqual(
    fixPaths({
      status: 'ahead',
      files: [
        { filename: 'src/a.ts' },
        { filename: 'tests/b.test.ts', previous_filename: 'tests/old.test.ts' },
        { filename: 'src/a.ts' },
      ],
    }),
    ['src/a.ts', 'tests/b.test.ts', 'tests/old.test.ts'],
  );
});

test('a comparison that is not the fix alone says nothing', () => {
  // After a rebase the reviewed commit is not an ancestor of the head, and a three-dot compare
  // would report main's commits as part of the fix.
  assert.equal(fixPaths({ status: 'diverged', files: [] }), null);
  assert.equal(fixPaths({ status: 'behind', files: [] }), null);
  assert.equal(fixPaths({ status: 'identical', files: [] }), null);
  assert.equal(fixPaths({ status: 'ahead' }), null);
  assert.equal(fixPaths(null), null);
});

test('a file list at the API cap may be cut short, so it says nothing', () => {
  const files = Array.from({ length: MAX_COMPARE_FILES }, (_, i) => ({
    filename: `docs/${i}.md`,
  }));
  assert.equal(fixPaths({ status: 'ahead', files }), null);
  assert.equal(
    fixPaths({ status: 'ahead', files: files.slice(1) })?.length,
    MAX_COMPARE_FILES - 1,
  );
});

test('a production-anchored finding fixed only in a test or doc is soft', () => {
  assert.equal(weigh({ paths: ['tests/a.test.ts', 'docs/notes.md'] }), 'soft');
});

test('a soft-anchored finding fixed in production code is substantive', () => {
  assert.equal(
    weigh({ anchorWeight: 'soft', paths: ['tests/a.test.ts', 'src/a.ts'] }),
    'substantive',
  );
});

test('a production fix of a production finding stays substantive', () => {
  assert.equal(weigh({ paths: ['src/a.ts'] }), 'substantive');
});

test('when the fix cannot be read, the anchors decide', () => {
  assert.equal(weigh({ paths: null }), 'substantive');
  assert.equal(weigh({ paths: null, anchorWeight: 'soft' }), 'soft');
});

test('a round with every finding answered, or only suppressed ones, fixed nothing that counts', () => {
  assert.equal(
    weigh({ anchorWeight: 'soft', open: 0, paths: ['src/a.ts'] }),
    'soft',
  );
  assert.equal(
    weigh({ anchorWeight: 'soft', describing: true, paths: ['src/a.ts'] }),
    'soft',
  );
});
