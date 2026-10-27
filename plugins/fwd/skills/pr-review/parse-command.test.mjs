// node --test parse-command.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCommand, simpleCommands } from './parse-command.mjs';

const merge = (pr, repo = null) => ({ action: 'merge', pr, repo });
const rerequest = (pr, repo = null) => ({ action: 'rerequest', pr, repo });

test('a merge with the PR number first is gated', () => {
  assert.deepEqual(parseCommand('gh pr merge 42 --squash'), [merge('42')]);
});

test('a flag before the PR number no longer skips the gate', () => {
  assert.deepEqual(parseCommand('gh pr merge --squash 42'), [merge('42')]);
  assert.deepEqual(parseCommand('gh pr merge --squash --delete-branch 42'), [
    merge('42'),
  ]);
});

test("gh's own flags before the subcommand still name the merge", () => {
  assert.deepEqual(parseCommand('gh -R o/r pr merge --squash 42'), [
    merge('42', 'o/r'),
  ]);
});

test('a #-prefixed number is the PR', () => {
  assert.deepEqual(parseCommand("gh pr merge '#42' --squash"), [merge('42')]);
});

test('a flag value is never read as the PR', () => {
  assert.deepEqual(parseCommand('gh pr merge --subject "Fix 7 bugs" -t 9 42'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand('gh pr merge -R o/r --squash 42'), [
    merge('42', 'o/r'),
  ]);
});

test('a separator inside a quoted value does not end the command', () => {
  assert.deepEqual(parseCommand('gh pr merge --subject "fix; tidy" 42'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand("gh pr merge --body 'a | b' --squash 42"), [
    merge('42'),
  ]);
});

test('a pull URL names both the PR and its repository', () => {
  assert.deepEqual(
    parseCommand('gh pr merge https://github.com/o/r/pull/42 --squash'),
    [merge('42', 'o/r')],
  );
});

test('a merge naming no number (current branch or a branch name) is not gated', () => {
  assert.deepEqual(parseCommand('gh pr merge --squash'), []);
  assert.deepEqual(parseCommand('gh pr merge feat/x --squash'), []);
});

test('every gated command in a chain is reported, not only the first', () => {
  assert.deepEqual(parseCommand('gh pr merge feat/x; gh pr merge 42'), [
    merge('42'),
  ]);
  assert.deepEqual(
    parseCommand(
      'gh pr merge --squash && gh api -X PUT repos/o/r/pulls/42/merge',
    ),
    [merge('42', 'o/r')],
  );
  assert.deepEqual(parseCommand('gh pr merge 1 && gh pr merge 2'), [
    merge('1'),
    merge('2'),
  ]);
});

test("one command's repository never reaches another's", () => {
  assert.deepEqual(parseCommand('gh pr view 1 -R a/b && gh pr merge 42'), [
    merge('42'),
  ]);
});

test('separators split commands the way a shell does', () => {
  assert.deepEqual(simpleCommands('a "b; c" && d | e; f\ng'), [
    ['a', 'b; c'],
    ['d'],
    ['e'],
    ['f'],
    ['g'],
  ]);
});

test('the REST merge is gated, with the repository from its path', () => {
  assert.deepEqual(parseCommand('gh api -X PUT repos/o/r/pulls/42/merge'), [
    merge('42', 'o/r'),
  ]);
});

test('a raw re-request and the wrapper script are both gated', () => {
  assert.deepEqual(
    parseCommand(
      'gh api -X POST repos/o/r/pulls/42/requested_reviewers --input -',
    ),
    [rerequest('42', 'o/r')],
  );
  assert.deepEqual(parseCommand('./scripts/request-copilot-review.sh 42'), [
    rerequest('42'),
  ]);
});

test('the repository comes from --repo, --repo= or GH_REPO when the path has none', () => {
  assert.deepEqual(parseCommand('gh pr merge 42 --repo o/r'), [
    merge('42', 'o/r'),
  ]);
  assert.deepEqual(parseCommand('gh pr merge 42 --repo=o/r'), [
    merge('42', 'o/r'),
  ]);
  assert.deepEqual(parseCommand('GH_REPO=o/r gh pr merge 42'), [
    merge('42', 'o/r'),
  ]);
});

test('anything else is not gated', () => {
  assert.deepEqual(parseCommand('git status'), []);
  assert.deepEqual(parseCommand('gh pr view 42'), []);
  assert.deepEqual(parseCommand('git merge main'), []);
});
