// node --test claude-review.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { claudeReviewState, RECORD_HINT } from './claude-review.mjs';

const body = (review) =>
  `Summary.\n\n## Claude review\n\n${review}\n\n## Settled\n\nnothing \`x.ts\`\n`;

test('a body with no Claude review heading has no review', () => {
  assert.deepEqual(claudeReviewState('Summary.\n\n## Settled\n\nnone\n'), {
    present: false,
    recorded: false,
  });
  assert.deepEqual(claudeReviewState(undefined), {
    present: false,
    recorded: false,
  });
});

test('a heading whose section says only "(pending)" is not a record', () => {
  assert.deepEqual(claudeReviewState(body('(pending)')), {
    present: true,
    recorded: false,
  });
});

for (const placeholder of [
  '',
  '   \n\n  ',
  '<!-- fill in after the review -->',
  'pending',
  '_Pending._',
  'TBD',
  'todo',
  'To do',
  'WIP',
  'n/a',
  'N/A.',
  '- [ ] pending',
  'Pending: cavecrew-reviewer on the diff',
  '<!-- reviewer -->\nTBD',
]) {
  test(`a placeholder section is not a record: ${JSON.stringify(placeholder)}`, () => {
    assert.equal(claudeReviewState(body(placeholder)).recorded, false);
  });
}

test('an empty section at the end of the body is not a record', () => {
  assert.equal(
    claudeReviewState('Summary.\n\n## Claude review\n').recorded,
    false,
  );
});

for (const record of [
  'cavecrew-reviewer: no findings.',
  'One-sentence revert to the exact text of #12; no logic change.',
  'Workflow-only change; one input renamed.',
  '`cavecrew-reviewer`: 0 findings, 1 question. Confirmed.',
  'Reviewer: `/code-review` medium, run before Copilot. 0 findings.',
  'None.',
  'No findings.',
  // A finding about a pending state is a record, not a placeholder.
  'cavecrew-reviewer: 1 Medium, the pending badge never clears. Fixed.',
]) {
  test(`a real record counts: ${JSON.stringify(record)}`, () => {
    assert.equal(claudeReviewState(body(record)).recorded, true);
  });
}

test('a record on the heading line itself counts', () => {
  assert.equal(
    claudeReviewState(
      'Summary.\n\n## Claude review: cavecrew-reviewer, no findings\n\n## Size\n\nsmall\n',
    ).recorded,
    true,
  );
});

test('a sub-heading inside the section stays in it', () => {
  assert.equal(
    claudeReviewState(body('### Findings\n\ncavecrew-reviewer: 1 Low, fixed.'))
      .recorded,
    true,
  );
  assert.equal(
    claudeReviewState(body('### Findings\n\n(pending)')).recorded,
    false,
  );
});

test('a later section cannot stand in for an empty review', () => {
  assert.equal(
    claudeReviewState(
      'Summary.\n\n## Claude review\n\n(pending)\n\n## Settled\n\ncavecrew-reviewer: no findings.\n',
    ).recorded,
    false,
  );
});

test('the hint says what to write', () => {
  assert.match(RECORD_HINT, /cavecrew-reviewer: no findings\./);
});
