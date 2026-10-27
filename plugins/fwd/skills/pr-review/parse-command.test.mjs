// node --test parse-command.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCommand,
  simpleCommands,
  unaccountedMerges,
  unreadableLine,
} from './parse-command.mjs';

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

test('a merge naming no number (current branch or a branch name) is unreadable, so denied', () => {
  for (const cmd of ['gh pr merge --squash', 'gh pr merge feat/x --squash']) {
    assert.deepEqual(parseCommand(cmd), [merge(null)]);
    assert.equal(unaccountedMerges(cmd), 1, cmd);
  }
});

test('every gated command in a chain is reported, not only the first', () => {
  assert.deepEqual(parseCommand('gh pr merge feat/x; gh pr merge 42'), [
    merge(null),
    merge('42'),
  ]);
  assert.deepEqual(
    parseCommand(
      'gh pr merge --squash && gh api -X PUT repos/o/r/pulls/42/merge',
    ),
    [merge(null), merge('42', 'o/r')],
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

test('a backslash-newline continuation joins the line, as a shell does', () => {
  assert.deepEqual(parseCommand('gh pr merge \\\n  42 --squash'), [
    merge('42'),
  ]);
});

test('a subshell, a command substitution or backticks still run the merge', () => {
  assert.deepEqual(parseCommand('(gh pr merge 42 --squash)'), [merge('42')]);
  assert.deepEqual(parseCommand('x=$(gh pr merge 42)'), [merge('42')]);
  assert.deepEqual(parseCommand('echo `gh pr merge 42`'), [merge('42')]);
});

test('a shell wrapper or eval is parsed as the command line it runs', () => {
  assert.deepEqual(parseCommand("bash -c 'gh pr merge 42 --squash'"), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand('/bin/zsh -lc "cd x && gh pr merge 42"'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand("eval 'gh pr merge 42'"), [merge('42')]);
  assert.deepEqual(parseCommand('bash scripts/build.sh 42'), []);
});

test('an explicit repository wins over GH_REPO', () => {
  assert.deepEqual(parseCommand('GH_REPO=a/b gh pr merge 42 --repo c/d'), [
    merge('42', 'c/d'),
  ]);
  assert.deepEqual(
    parseCommand('GH_REPO=a/b gh api -X PUT repos/c/d/pulls/42/merge'),
    [merge('42', 'c/d')],
  );
});

test('a substitution inside double quotes still runs its command', () => {
  assert.deepEqual(parseCommand('result="$(gh pr merge 42 --squash)"'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand('echo "done: `gh pr merge 42`"'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand("echo '$(gh pr merge 42)'"), []);
});

test('a comment is skipped, apostrophes and all', () => {
  assert.deepEqual(
    parseCommand("# don't skip the gate\ngh pr merge 42 --squash"),
    [merge('42')],
  );
  assert.deepEqual(parseCommand('gh pr merge 42 # merged'), [merge('42')]);
});

test('a path-qualified gh is gh', () => {
  assert.deepEqual(parseCommand('/usr/local/bin/gh pr merge 42'), [
    merge('42'),
  ]);
});

test('a shell or eval only counts in the executable position', () => {
  assert.deepEqual(parseCommand('gh pr merge 42 --subject eval'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand("env FOO=1 bash -c 'gh pr merge 42'"), [
    merge('42'),
  ]);
});

test('GH_REPO on a shell wrapper is the default for what it runs', () => {
  assert.deepEqual(parseCommand("GH_REPO=a/b bash -c 'gh pr merge 42'"), [
    merge('42', 'a/b'),
  ]);
  assert.deepEqual(
    parseCommand("GH_REPO=a/b bash -c 'gh pr merge 42 -R c/d'"),
    [merge('42', 'c/d')],
  );
});

// Round 3 of review found six more shell forms. Each is either read correctly or counted as
// unreadable (and denied); none may come back as an empty, allowed result.
test('forms the parser cannot read fail closed instead of passing', () => {
  for (const cmd of [
    "cat <<'EOF'\ndon't\nEOF\ngh pr merge 42 --squash",
    'gh pr merge --squash --match-head-commit $(git rev-parse HEAD) 42',
    'gh pr merge --squash 2>/dev/null 42',
    `result="$(printf ')'; gh pr merge 42 --squash)"`,
    "env -u FOO bash -c 'gh pr merge 42 --squash'",
  ]) {
    const read = parseCommand(cmd).filter((g) => g.action === 'merge');
    assert.ok(
      read.some((g) => g.pr === '42') || unaccountedMerges(cmd) > 0,
      cmd,
    );
  }
});

test('a repository path inside a flag value is text, not the target', () => {
  assert.deepEqual(
    parseCommand("gh pr merge 42 -R o/r --body 'See repos/a/b/pulls/7/'"),
    [merge('42', 'o/r')],
  );
});

test('every merge the text mentions is accounted for when the parser reads them all', () => {
  assert.equal(unaccountedMerges('gh pr merge 1 && gh pr merge 2'), 0);
  assert.equal(unaccountedMerges('gh api -X PUT repos/o/r/pulls/4/merge'), 0);
  assert.equal(unaccountedMerges('git merge main'), 0);
});

test('the attached -R form names the repository', () => {
  assert.deepEqual(parseCommand('gh pr merge 42 -Ro/r --squash'), [
    merge('42', 'o/r'),
  ]);
});

test('a merge the tokenizer finds but cannot resolve is unreadable, whatever its spelling', () => {
  for (const cmd of [
    "gh pr 'merge' --squash",
    'gh pr \\\nmerge --squash',
    'bash -c "gh pr \'merge\'"',
  ])
    assert.ok(unaccountedMerges(cmd) > 0, cmd);
});

test('a full API URL keeps its repository', () => {
  assert.deepEqual(
    parseCommand(
      'gh api -X POST https://api.github.com/repos/o/r/pulls/42/requested_reviewers --input -',
    ),
    [rerequest('42', 'o/r')],
  );
});

test('a repository flag between pr and merge is read', () => {
  assert.deepEqual(parseCommand('gh pr -R o/r merge 42 --squash'), [
    merge('42', 'o/r'),
  ]);
  assert.deepEqual(parseCommand('gh pr --repo=o/r merge 42'), [
    merge('42', 'o/r'),
  ]);
});

test('an option the allowlist does not know makes the merge unreadable', () => {
  for (const cmd of [
    'gh pr merge -st 9 42',
    'gh pr merge --some-new-flag 42',
    'gh --verbose pr merge 42',
  ])
    assert.ok(unaccountedMerges(cmd) > 0, cmd);
});

test('a merge that was read cannot cancel one that was not', () => {
  const cmd =
    "gh pr 'merge' 41 --squash; cat <<'EOF'\ndon't\nEOF\ngh pr merge 42 --squash";
  assert.ok(unaccountedMerges(cmd) > 0);
});

test('a git merge after another gh command is not a PR merge', () => {
  assert.equal(unaccountedMerges('gh pr view 1 && git merge main'), 0);
});

test('an expansion or an unreadable selector makes the merge unreadable', () => {
  for (const cmd of [
    'gh pr merge "4$(printf 2)" --squash',
    'gh pr merge $PR --squash',
    'gh pr merge 42 --repo "$TARGET_REPO"',
    'gh pr merge 42 --repo github.com/o/r',
    'gh pr merge fix/github.com/o/r/pull/42 --squash',
    'export GH_REPO=o/r; gh pr merge 42 --squash',
  ])
    assert.ok(unaccountedMerges(cmd) > 0, cmd);
  // A GH_REPO on the merge itself is its own repository, and stays readable.
  assert.deepEqual(parseCommand('GH_REPO=o/r gh pr merge 42'), [
    merge('42', 'o/r'),
  ]);
});

test('any expansion in a gated command makes it unreadable', () => {
  for (const cmd of [
    'gh api -X PUT "repos/$OWNER/$REPOSITORY/pulls/42/' + 'mer' + 'ge"',
    'GH_REPO="$TARGET_REPO" gh pr merge 42 --squash',
  ])
    assert.ok(unaccountedMerges(cmd) > 0, cmd);
  const rr = parseCommand(
    'gh api -X POST "repos/$O/$R/pulls/42/requested_reviewers"',
  );
  assert.equal(rr[0].pr, null);
});

test('a gated command line holding any expansion or a repeated GH_REPO is unreadable as a whole', () => {
  for (const cmd of [
    'GH_REPO=a/b GH_REPO=o/r gh pr merge 42 --squash',
    'gh api -X PUT "repos/o/r/pulls/$PR/merge"',
    'gh api -X POST "repos/o/r/pulls/$PR/requested_reviewers"',
    `GH_REPO="$TARGET_REPO" bash -c 'gh pr merge 42 --squash'`,
  ])
    assert.equal(unreadableLine(cmd), true, cmd);
  // An expansion in a line with no gated action is none of the gate's business.
  assert.equal(unreadableLine('echo $HOME && git status'), false);
  assert.equal(unreadableLine('gh pr merge 42 --squash'), false);
});

test('repeated selectors, redirections, quoted unresolved forms and unread re-requests are unreadable', () => {
  for (const cmd of [
    'gh pr merge 42 -R a/b -R c/d --squash',
    'gh pr --repo="o/r" merge --squash',
    "env -u FOO bash -c 'request-copilot-review.sh 41; request-copilot-review.sh 42'",
  ])
    assert.equal(unreadableLine(cmd), true, cmd);
  assert.equal(unreadableLine('./scripts/request-copilot-review.sh 42'), false);
});

test('a redirection is not an argument', () => {
  assert.deepEqual(
    parseCommand('./scripts/request-copilot-review.sh 2>/dev/null 42'),
    [rerequest('42')],
  );
  assert.deepEqual(parseCommand('gh pr merge --squash >out.log 42'), [
    merge('42'),
  ]);
  // The documented re-request: JSON on stdin from a heredoc stays readable.
  const doc = `gh api -X POST repos/o/r/pulls/42/requested_reviewers --input - <<'JSON'\n{"reviewers":["x"]}\nJSON`;
  assert.deepEqual(parseCommand(doc), [rerequest('42', 'o/r')]);
  assert.equal(unreadableLine(doc), false);
});

test('only a leading GH_REPO is an assignment, and its value must be owner/name', () => {
  assert.equal(
    unreadableLine("GH_REPO=github.com/o/r bash -c 'gh pr merge 42'"),
    true,
  );
  assert.equal(unreadableLine('GH_REPO=github.com/o/r gh pr merge 42'), true);
  assert.deepEqual(parseCommand("bash -c 'gh pr merge 42' GH_REPO=a/b"), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand('gh pr merge 42 --body GH_REPO=a/b'), [
    merge('42'),
  ]);
  assert.deepEqual(parseCommand("GH_REPO=a/b bash -c 'gh pr merge 42'"), [
    merge('42', 'a/b'),
  ]);
});

test('anything else is not gated', () => {
  assert.deepEqual(parseCommand('git status'), []);
  assert.deepEqual(parseCommand('gh pr view 42'), []);
  assert.deepEqual(parseCommand('git merge main'), []);
});
