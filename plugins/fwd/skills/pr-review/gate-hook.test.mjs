// node --test gate-hook.test.mjs
// The hook end to end, outside any git checkout. The real gate needs the GitHub API, so the hook
// runs from a copy of this folder whose pr-gate.mjs is a stub that records how it was called and
// denies. Every case here is about WHICH repository and directory reach the gate, and that the
// hook still denies whenever none can be resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// A scratch tree that is not a git checkout: the session directory the hook runs in.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'gate-hook-')));
const outside = join(root, 'session');
mkdirSync(outside);
const checkout = join(root, 'checkout');
mkdirSync(checkout);

// plugin/skills/pr-review/{gate-hook.sh,parse-command.mjs,pr-gate.mjs stub} and plugin/lib/is-main.mjs,
// the layout parse-command.mjs imports from.
const plugin = join(root, 'plugin');
const skill = join(plugin, 'skills', 'pr-review');
mkdirSync(skill, { recursive: true });
mkdirSync(join(plugin, 'lib'));
copyFileSync(join(here, 'gate-hook.sh'), join(skill, 'gate-hook.sh'));
copyFileSync(join(here, 'parse-command.mjs'), join(skill, 'parse-command.mjs'));
copyFileSync(
  join(here, '..', '..', 'lib', 'is-main.mjs'),
  join(plugin, 'lib', 'is-main.mjs'),
);
writeFileSync(
  join(skill, 'pr-gate.mjs'),
  "console.log('STUB ' + JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\nprocess.exit(1);\n",
);

const hook = (command, { stub = true } = {}) => {
  const script = stub
    ? join(skill, 'gate-hook.sh')
    : join(here, 'gate-hook.sh');
  const env = { ...process.env };
  delete env.GH_REPO;
  const r = spawnSync('bash', [script], {
    cwd: outside,
    env,
    encoding: 'utf8',
    input: JSON.stringify({ cwd: outside, tool_input: { command } }),
  });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout.trim() === '') return { allowed: true };
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  const stub_ = out.permissionDecisionReason.match(/STUB (\{.*\})/);
  return {
    allowed: false,
    reason: out.permissionDecisionReason,
    gate: stub_ ? JSON.parse(stub_[1]) : null,
  };
};

const M = 'gh pr ' + 'merge';

test('an explicit --repo reaches the gate even outside a checkout', () => {
  const r = hook(`${M} 42 --repo o/r --squash`);
  assert.deepEqual(r.gate.args, ['42', '--action', 'merge', '--repo', 'o/r']);
  assert.equal(r.gate.cwd, outside);
});

test('an explicit repository wins over a directory the hook cannot follow', () => {
  const r = hook(`cd - && ${M} 42 -R o/r`);
  assert.deepEqual(r.gate.args, ['42', '--action', 'merge', '--repo', 'o/r']);
});

test('an explicit repository wins over the directory the command cds into', () => {
  const r = hook(`cd ${checkout} && ${M} 42 --repo o/r`);
  assert.deepEqual(r.gate.args, ['42', '--action', 'merge', '--repo', 'o/r']);
  // The gate still starts there, for its push-landed check.
  assert.equal(r.gate.cwd, checkout);
});

test('the REST re-request names its repository in the path', () => {
  const r = hook(
    'gh api -X POST repos/o/r/pulls/42/requested_' + 'reviewers --input -',
  );
  assert.deepEqual(r.gate.args, [
    '42',
    '--action',
    'rerequest',
    '--repo',
    'o/r',
  ]);
});

test('with no repository named, the gate starts in the directory the command cds into', () => {
  const r = hook(`cd ${checkout} && ./scripts/request-copilot-review.sh 42`);
  assert.deepEqual(r.gate.args, ['42', '--action', 'rerequest']);
  assert.equal(r.gate.cwd, checkout);
});

test('with no repository named and no cd, the gate starts in the session directory', () => {
  const r = hook(`${M} 42`);
  assert.deepEqual(r.gate.args, ['42', '--action', 'merge']);
  assert.equal(r.gate.cwd, outside);
});

test('a directory the hook cannot follow, with no repository named, is denied before the gate', () => {
  const r = hook(`cd - && ${M} 42`);
  assert.equal(r.allowed, false);
  assert.equal(r.gate, null);
  assert.match(r.reason, /cannot follow/);
});

test('a cd into a directory that does not exist, with no repository named, is denied', () => {
  const r = hook(`cd ${join(root, 'missing')} && ${M} 42`);
  assert.equal(r.allowed, false);
  assert.equal(r.gate, null);
  assert.match(r.reason, /does not exist/);
});

test('the real gate, outside a checkout with no repository named, denies with the reason', () => {
  const r = hook(`${M} 42`, { stub: false });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /cannot tell which repository PR #42 is in/);
  assert.doesNotMatch(r.reason, /not a git repository/);
});

test('anything ungated is allowed without running the gate', () => {
  assert.deepEqual(hook('git status'), { allowed: true });
});
