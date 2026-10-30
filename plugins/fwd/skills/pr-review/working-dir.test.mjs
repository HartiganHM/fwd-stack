// node --test working-dir.test.mjs
// The directory a gated command runs in (parse-command.mjs workingDir), read so the hook can start
// the gate where the command runs rather than in the session's directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listElements,
  listWithOperators,
  workingDir,
} from './parse-command.mjs';

const home = '/home/u';
const at = (cmd, cwd = '/work') => workingDir(cmd, cwd, home);

test('a line with no cd keeps the session directory', () => {
  assert.deepEqual(at('gh pr merge 42 --squash'), { dir: null });
  assert.deepEqual(at('./scripts/request-copilot-review.sh 42'), { dir: null });
});

test('a plain cd before the gated command names its directory', () => {
  assert.deepEqual(at('cd /repos/app && gh pr merge 42 --squash'), {
    dir: '/repos/app',
  });
  assert.deepEqual(at('cd app; gh pr merge 42'), { dir: '/work/app' });
  assert.deepEqual(at('cd ~/Projects/app && gh pr merge 42'), {
    dir: '/home/u/Projects/app',
  });
  assert.deepEqual(at('cd "/a b/app" && gh pr merge 42'), { dir: '/a b/app' });
  assert.deepEqual(at('cd /a && cd b && gh pr merge 42'), { dir: '/a/b' });
});

test('the form seen in the field: cd into a worktree, then the wrapper script piped to tail', () => {
  assert.deepEqual(
    at(
      'cd /p/app/.worktrees/x && ./scripts/request-copilot-review.sh 42 2>&1 | tail -3; node gate.mjs 42 2>&1 | tail -15',
      '/p',
    ),
    { dir: '/p/app/.worktrees/x' },
  );
});

test('a cd after the gated command does not move it', () => {
  assert.deepEqual(at('gh pr merge 42 && cd /elsewhere'), { dir: null });
});

test('a cd back to the session directory reads as the session directory', () => {
  assert.deepEqual(at('cd /work && gh pr merge 42'), { dir: null });
});

test('a cd the hook cannot follow leaves the directory unknown', () => {
  for (const cmd of [
    'cd && gh pr merge 42',
    'cd - && gh pr merge 42',
    'cd -P /x && gh pr merge 42',
    'cd /x 2>/dev/null && gh pr merge 42',
    'pushd /x && gh pr merge 42',
    'cd /x & gh pr merge 42',
    '(cd /x && gh pr merge 42)',
    'cd /x | gh pr merge 42',
    'cd /a && gh pr merge 1; cd /b && gh pr merge 2',
  ])
    assert.deepEqual(at(cmd), { unknown: true }, cmd);
});

test('a cd on one branch of ||, behind a prefix or keyword, in eval, or a sourced file is unknown', () => {
  for (const cmd of [
    // Either cd may be the one that ran.
    'cd /repo-a || cd /repo-b; gh pr merge 42',
    // eval runs in this shell, so its cd moves the merge.
    "cd /repo-a && eval 'cd /repo-b' && gh pr merge 42",
    'cd /repo-a && command cd /repo-b && gh pr merge 42',
    'cd /repo-a && builtin cd /repo-b && gh pr merge 42',
    'cd /repo-a; if true; then cd /repo-b; fi; gh pr merge 42',
    'cd /repo-a && { cd /repo-b; } && gh pr merge 42',
    'cd /repo-a && env -i cd /repo-b && gh pr merge 42',
    'source ./env.sh && gh pr merge 42',
    '. ./env.sh && gh pr merge 42',
  ])
    assert.deepEqual(at(cmd), { unknown: true }, cmd);
});

test('shell grammar the walker does not model makes a directory-changing line unknown', () => {
  for (const cmd of [
    "cd /repo-a && builtin eval 'cd /repo-b' && gh pr merge 42",
    'cd /repo-a && if true; then gh pr merge 42; fi',
    'cd /repo-a && for x in 1; do gh pr merge 42; done',
    'cd /repo-a && bash -c \'command eval "cd /b" && gh pr merge 42\'',
  ])
    assert.deepEqual(at(cmd), { unknown: true }, cmd);
});

test('a backgrounded list, or a moving wrapper sharing its element, is unknown', () => {
  for (const cmd of [
    // `&` backgrounds `cd /repo-b && sleep 1`, so the merge stays where it was.
    'cd /repo-b && sleep 1 & gh pr merge 42',
    "bash -c 'cd /repo-b && gh pr merge 42' | cat",
  ])
    assert.deepEqual(at(cmd), { unknown: true }, cmd);
  // Redirections are not backgrounding.
  assert.deepEqual(at('cd /x && gh pr merge 42 2>&1 | tail -3'), { dir: '/x' });
});

test('a cd that runs only if the command before it succeeded settles nothing after its chain', () => {
  for (const cmd of [
    // The merge runs whether or not the cd did.
    'false && cd /repo-b; gh pr merge 42',
    'false && cd /repo-b\ngh pr merge 42',
    // A line break straight after && continues the chain.
    'false &&\ncd /repo-b; gh pr merge 42',
  ])
    assert.deepEqual(at(cmd), { unknown: true }, cmd);
  // Inside the chain, the merge runs only where the cd took it.
  assert.deepEqual(at('make && cd /x && gh pr merge 42'), { dir: '/x' });
  // A cd that always runs, to an absolute path, settles it again.
  assert.deepEqual(at('false && cd /b; cd /c; gh pr merge 42'), { dir: '/c' });
});

test('elements carry the operator that joined them', () => {
  assert.deepEqual(
    listWithOperators('a && b || c; d\ne &&\nf').map((e) => e.op),
    ['', '&&', '||', ';', ';', '&&'],
  );
});

test('a separator inside a shell comment separates nothing', () => {
  assert.deepEqual(at('cd /repo-a # note; cd /repo-b\ngh pr merge 42'), {
    dir: '/repo-a',
  });
  assert.deepEqual(listElements("a # it's; b\nc"), ["a # it's; b", 'c']);
  // A # inside a word is not a comment.
  assert.deepEqual(listElements('a#b; c'), ['a#b', 'c']);
});

test('a cd spelled with a backslash or quotes is still a cd', () => {
  assert.deepEqual(at('\\cd /repo-b && gh pr merge 42'), { dir: '/repo-b' });
  assert.deepEqual(at("'cd' /repo-b && gh pr merge 42"), { dir: '/repo-b' });
  assert.deepEqual(at("bash -c '\\cd /repo-b && gh pr merge 42'"), {
    dir: '/repo-b',
  });
});

test('a lone dot that is an argument, not a command, changes nothing', () => {
  assert.deepEqual(at('git add . && gh pr merge 42'), { dir: null });
  assert.deepEqual(at('cd /x && git add . && gh pr merge 42'), { dir: '/x' });
});

test('a relative cd with no session directory is unknown', () => {
  assert.deepEqual(at('cd app && gh pr merge 42', null), { unknown: true });
  assert.deepEqual(at('cd /abs/app && gh pr merge 42', null), {
    dir: '/abs/app',
  });
});

test("a subshell's own cd, or a cd in text, does not move a gated command beside it", () => {
  assert.deepEqual(at('(cd /x && make) && gh pr merge 42'), { dir: null });
  assert.deepEqual(at('echo "cd /x" && gh pr merge 42'), { dir: null });
});

test("a shell wrapper's cd moves its own gated commands only", () => {
  assert.deepEqual(at("bash -c 'cd /x && gh pr merge 42'"), { dir: '/x' });
  assert.deepEqual(at("bash -c 'cd /x && make' && gh pr merge 42"), {
    dir: null,
  });
  assert.deepEqual(at("bash -c 'cd - && gh pr merge 42'"), { unknown: true });
});

test('list elements split on && || ; and newlines outside quotes, parentheses and backticks', () => {
  assert.deepEqual(listElements('a && b || c; d\ne'), [
    'a',
    'b',
    'c',
    'd',
    'e',
  ]);
  assert.deepEqual(listElements('echo "a && b"; (c; d) && `e; f`'), [
    'echo "a && b"',
    '(c; d)',
    '`e; f`',
  ]);
  assert.deepEqual(listElements('a 2>&1 | b & c'), ['a 2>&1 | b & c']);
});
